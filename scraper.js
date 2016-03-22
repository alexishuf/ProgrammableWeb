// This is a template for a Node.js scraper on morph.io (https://morph.io)

var assert = require('assert');
var _ = require('lodash');
var cheerio = require('cheerio');
var sqlite3 = require('sqlite3').verbose();
var Promise = require('bluebird');

//FIXME
var makeRequest = Promise.promisify(require('makeRequest'), {multiArgs: true});

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

function cloneStr(str) {
  if (_.isString(str))
    return (' ' + str).substr(1);
  return str;
}

function fetchPage(url) {
  url = baseUrl + url;
  //Forbid redirects, since ProgrammableWeb has duplicates and even loops.
  return makeRequest('get', url, {followRedirect: false}).spread(function (response, body) {
    return cheerio.load(body);
  });
}

function directoryPage(url, links) {
  return fetchPage(url)
    .then(function ($) {
      $('.views-field-title.col-md-3 a').each(function () {
        links.push(cloneStr($(this).attr('href')));
      });
      return cloneStr($('.pager-last a').attr('href'));
    })
    .then(function (next) {
      global.gc();
      if (next) {
        return directoryPage(next, links);
      }
    });
}

function getFollowers($) {
  var str = $('.followers-block .block-title span').text()
  return str.match(/Followers \((\d+)\)/)[1];
}

function apiPage(url) {
  return fetchPage(url).then(function ($) {
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

    return _.mapValues(row, cloneStr);
  }).then (function (row) {
    global.gc();
    return row;
  });
}

function run(db) {
  var errors = [];
  var links = [];
  directoryPage('/apis/directory', links)
    .then(function () {
      Promise.mapSeries(links, function (url) {
        return apiPage(url)
          .then(function (row) {
            updateRow(row);
          })
          .catch(function (err) {
            console.error(err);
            errors.push(err);
          });
    })
    .then(function () {
      console.log('Finish');
      console.error(errors);
      db.close();
    });
  });
}

initDatabase(run);
