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

// fields extracted .from field divs
var dynamicFields = [
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
  'Docs_Homepage_URL',
  'API_Design_Description_Non_Proprietary',
  'Terms_Service_URL',
  'Authentication_Model',
  'Scope',
  'Device_Specific',
  'Supported_Request_Formats',
  'Unofficial_API',
  'Hypermedia_API',
  'Restricted_Access',
  'Support_Email_Address',
  'How_API_different',
  'Version',
  'Type',
  'Architectural_Style',
  'Supported_Response_Formats',
  'API_related_anyother_API'
];

var fields = [
  'url',
  'title',
  'description',
  'followers'
].concat(dynamicFields);


var fieldsRegExps = _.map(dynamicFields, function (field) {
  var rx = new RegExp('^(?:.*_)?' + _.reduce(field.split('_'), function (rx, term) {
    return rx + '(?:_.*_|_)' + term;
  }) + '(?:_.*)?$', 'i');

  return {rx: rx, field: field};
});

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

function preprocessLabel(label) {
  var old = null;
  while (old !== label) {
    old = label;
    _([ ['/', '_'], ['-', '_'], ['+', '_'], [/ +/, '_'], [/__+/, '_'],
        ['Home_Page', 'Homepage'],
        [/[ _](is|this|the|an?|for|in|on)[ _]/i, ' '],
        [/^(is|this|the|an?|for|in|on)[ _]/i, ' '],
        [/[.;,?]+/, ''], [/[ _]$/, ''], [/^[ _]/, ''] ])
      .each(function (args) {
        var tmp = label;
        label = label.replace(args[0], args[1]);
      });
  }
  return label;
}


function chooseField(label) {
  label = preprocessLabel(label);
  var longestMatch = _.maxBy(
      _.filter(fieldsRegExps, function (obj) { return obj.rx.test(label); }),
      function (obj) {return obj.field.length;}
  );
  return longestMatch == undefined ? label : longestMatch.field;
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
      var name = $(this).children('label').text();
      name = chooseField(name);
      if (fields.indexOf(name) === -1) {
        console.error('Unknown field: ' + name);
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
