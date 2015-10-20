// This is a template for a Node.js scraper on morph.io (https://morph.io)

var assert = require('assert');
var _ = require('lodash');
var cheerio = require('cheerio');
var async = require('async');
var request = require('request');
var sqlite3 = require('sqlite3').verbose();

var db = new sqlite3.Database('data.sqlite');

var baseUrl = 'http://www.programmableweb.com';
var fields = [
  'url',
  'title',
  'description',
  'followers',
  'API_Endpoint',
  'API_Forum',
  'API_Homepage',
  'API_Kits',
  'API_Provider',
  'Authentication_Mode',
  'Console_URL',
  'Contact_Email',
  'Developer_Support',
  'Other_options',
  'Primary_Category',
  'Protocol_Formats',
  'Secondary_Categories',
  'SSL_Support',
  'Twitter_Url'
];

function initDatabase(callback) {
  // Set up sqlite database.
  db.serialize(function() {
    var listFields = fields.join(' TEXT, ') + ' TEXT';
    db.run('CREATE TABLE IF NOT EXISTS apis (' + listFields + ', PRIMARY KEY(url))');
    callback(db);
  });
}

function updateRow(row) {
  //Add missing fields
  _.each(fields, function (name) {
    name = '$' + name;
    row[name] = row[name] || null;
  });

  var listFields = '$' + fields.join(', $');
  var statement = db.prepare('REPLACE INTO apis VALUES ('+ listFields + ')');
  statement.run(row);
  statement.finalize();
}

function fetchPage(url, callback) {
  url = baseUrl + url;
  request(url, function (error, response, body) {
    if (error)
      return callback(Error('Error requesting ' + url + ': ' + error));
    if (response.statusCode !== 200)
      return callback(Error('Can not GET "' + url +'": ' + response.statusMessage));

    var redirectURL = response.request.uri.href;
    if (url === redirectURL)
      return callback(Error('Redirect from "' + url + '" to "' + redirectURL + '"'));

    console.log(url);
    callback(null, cheerio.load(body));
  });
}

function directoryPage(url, links, callback) {
  fetchPage(url, function (err, $) {
    assert(!err, err);
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

function getFollowers($) {
  var str = $('.followers-block .block-title span').text()
  return str.match(/Followers \((\d+)\)/)[1];
}

function apiPage(url, callback) {
  fetchPage(url, function (err, $) {
    if (err) return callback(err);
    var row = {
      $url: baseUrl + url,
      $title: $('.node-header h1').text(),
      $description: $('.api_description').text().trim(),
      $followers: getFollowers($)
    };

    $('.specs .field').each(function () {
      var name = $(this).children('label').text();
      name = name.replace(/ \/ /, '_').replace(/ /, '_');
      if (fields.indexOf(name) === -1) {
        console.error('Unknown field: ' + name);
        return;
      }
      row['$'+ name] = $(this).children('span').text();
    });
    callback(null, row);
  });
}

function run(db) {
  var errors = [];
  getLinks(function (links) {
    async.forEachOfSeries(links, function (url, index, asyncCb) {
      apiPage(url, function (err, row) {
        if (err) {
          console.error(err);
          errors.push(err);
        }
        else
          updateRow(row);
        asyncCb(null);
      });
    }, function () {
      console.log('Finish');
      console.error(errors);
      db.close();
    });
  });
}

initDatabase(run);
