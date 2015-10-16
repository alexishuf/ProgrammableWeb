// This is a template for a Node.js scraper on morph.io (https://morph.io)

var assert = require('assert');
var _ = require('lodash');
var cheerio = require('cheerio');
var async = require('async');
var request = require('request');
var sqlite3 = require('sqlite3').verbose();

var db = new sqlite3.Database('data.sqlite');

function initDatabase(callback) {
  // Set up sqlite database.
  db.serialize(function() {
    db.run('CREATE TABLE IF NOT EXISTS apis (url TEXT, data TEXT, PRIMARY KEY(url))');
    callback(db);
  });
}

function updateRow(url, value) {
  // Insert some data.
  var statement = db.prepare('REPLACE INTO apis VALUES ($url, $data)');
  statement.run({$url: url, $data: value});
  statement.finalize();
}

function readRows() {
  // Read some data.
  db.each('SELECT url, data FROM apis', function(err, row) {
    console.log(row.url + ': ' + row.data);
  });
}

function fetchPage(url, callback) {
  url = 'http://www.programmableweb.com' + url;
  request(url, function (error, response, body) {
    assert(!error, 'Error requesting ' + url + ': ' + error);
    assert(response.statusCode === 200, 'Can not GET "' + url +'": ' + response.statusMessage);
    console.log(url);
    callback(cheerio.load(body));
  });
}

function directoryPage(url, links, callback) {
  fetchPage(url, function ($) {
    $('.col-md-3 a').each(function () {
      links.push($(this).attr('href'));
    });
    var next = $('.pager-last a').attr('href');
    if (next)
      return directoryPage(next, links, callback);
    callback(links);
  });
}

function getLinks(callback) {
  directoryPage('/apis/directory', [], function (links) {
    callback(links);
  });
}

function apiPage(url, callback) {
  fetchPage(url, function ($) {
    var row = [url, $('.node-header h1').text()];
    //console.log($('.node-header h1').text());
    //console.log($('.api_description').text().trim());
    //$('.specs .field').each(function () {
    //  console.log($(this).children('label').text());
    //  console.log($(this).children('span').text());
    //});
    //console.log($('.followers-block .block-title span').text());
    callback(row);
  });
}

function run(db) {
  getLinks(function (links) {
    async.forEachOfSeries(links, function (url, index, asyncCb) {
      apiPage(url, function (row) {
        updateRow(row[0], row[1]);
        asyncCb(null);
      });
    }, function () {
      console.log('Finish');
      readRows(db);
      db.close();
    });
  });
}

initDatabase(run);
