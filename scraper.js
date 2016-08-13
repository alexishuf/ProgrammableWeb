'use strict';

var assert = require('assert');

var _ = require('lodash');
var cheerio = require('cheerio');
var sqlite3 = require('sqlite3').verbose();
var Promise = require('bluebird');

var gcHacks = require('gc-hacks');
var makeRequest = require('makeRequest');

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
  'Twitter_Url',
  /* fields added on 2016-08-12: */
  'Terms_Of_Service_URL',
  'Scope',
  'Device_Specific',
  'Docs_Homepage_URL',
  'Supported_Request_Formats',
  'Version',
  'Type',
  'Architectural_Style',
  'Supported_Response_Formats',
  'API_Design_Description_Non_Proprietary',
  'Unofficial_API',
  'Hypermedia_API',
  'Restricted_Access',
  'How_API_different',
  'Related_APIs',
  'Description_File_URL',
  'Description_File_Type',
  'Developer_Homepage'
];

var labelToField = {
  /* mappings to the fields array (2016-08-12) */
  'Twitter_URL' : 'Twitter_Url',
  'API_Portal_/_Home_Page': 'API_Homepage',
  'API_Forum_/_Message_Boards': 'API_Forum',
  'Authentication_Model': 'Authentication_Mode',
  'Interactive_Console_URL': 'Console_URL',
  'Docs_Home_Page_URL': 'Docs_Homepage_URL',
  'Developer_Home_Page': 'Developer_Homepage',
  'Is_the_API_Design/Description_Non-Proprietary_?': 'API_Design_Description_Non_Proprietary',
  'Is_This_an_Unofficial_API?': 'Unofficial_API',
  'Is_This_a_Hypermedia_API?': 'Hypermedia_API',
  'Restricted_Access_(_Requires_Provider_Approval_)': 'Restricted_Access',
  'Support_Email_Address': 'Contact_Email',
  'Developer_Support_URL': 'Developer_Support',
  'How_is_this_API_different_?': 'How_API_different',
  'Is_the_API_related_to_anyother_API_?' : 'Related_APIs',
  'Description_File_URL_(if_public)' : 'Description_File_URL'
};

function chooseField(label) {
    label = label.trim().replace(/ /g, '_');
    return fields.indexOf(label) >= 0 ? label : labelToField[label];
}


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

function fetchPage(url, parseFn) {
  url = baseUrl + url;
  //Forbid redirects, since ProgrammableWeb has duplicates and even loops.
  return makeRequest('get', url, {followRedirect: false})
    .spread(gcHacks.recreateReturnObjectAndGcCollect(function (response, body) {
      return parseFn(cheerio.load(body));
    }));
}

function scrapeDirectoryPages() {
  return Promise.coroutine(function* () {
     var next = '/apis/directory'
     var links = [];

     while (next) {
       var result = yield fetchPage(next, function ($) {
         return [
           $('.views-field-title.col-md-3 a').map(function () {
             return $(this).attr('href');
           }).get(),
           $('.pager-last a').attr('href')
         ];
       });

       Array.prototype.push.apply(links, result[0]);
       next = result[1];
     }

     return links;
  })();
}

function getFollowers($) {
  var str = $('.followers-block .block-title span').text()
  return str.match(/Followers \((\d+)\)/)[1];
}

function scrapeApiPage(url) {
  return fetchPage(url, function ($) {
    var row = {
      $url: baseUrl + url,
      $title: $('.node-header h1').text(),
      $description: $('.api_description').text().trim(),
      $followers: getFollowers($)
    };

    $('.specs .field').each(function () {
      var label = $(this).children('label').text();
      var name = chooseField(label);
      if (name === undefined) {
        console.error('Unknown field: ' + label);
        return;
      }
      row['$'+ name] = $(this).children('span').text();
    });

    return row;
  })
}

function run(db) {
  var errors = [];
  scrapeDirectoryPages()
    .mapSeries(function (url) {
      return scrapeApiPage(url)
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
    })
    .done();
}

initDatabase(run);
