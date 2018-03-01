/**
 * Copyright 2016 IBM Corp. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the “License”);
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *  https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an “AS IS” BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

"use strict";
/* jshint node:true */

// Add the express web framework
const express = require("express");
const app = express();
const fs = require("fs");

// Use body-parser to handle the PUT data
const bodyParser = require("body-parser");
app.use(
    bodyParser.urlencoded({
        extended: false
    })
);

// Util is handy to have around, so thats why that's here.
const util = require('util')

// and so is assert
const assert = require('assert');

// We want to extract the port to publish our app on
let port = process.env.PORT || 8080;

// Then we'll pull in the database client library
const r = require("rethinkdb");

// We need to parse the connection string for the deployment
let parseRethinkdbUrl = require("parse-rethinkdb-url");

// Now lets get cfenv and ask it to parse the environment variable
const cfenv = require('cfenv');

// load local VCAP configuration  and service credentials
let vcapLocal;
try {
  vcapLocal = require('./vcap-local.json');
  console.log("Loaded local VCAP");
} catch (e) { 
    // console.log(e)
}

const appEnvOpts = vcapLocal ? { vcap: vcapLocal} : {}
const appEnv = cfenv.getAppEnv(appEnvOpts);

// Within the application environment (appenv) there's a services object
let services = appEnv.services;

// The services object is a map named by service so we extract the one for rethinkdb
let rethinkdb_services = services["compose-for-rethinkdb"];

// This check ensures there is a services for rethinkdb databases
assert(!util.isUndefined(rethinkdb_services), "Must be bound to compose-for-rethinkdb services");

// We now take the first bound rethinkdb service and extract it's credentials object
let credentials = rethinkdb_services[0].credentials;

let options = parseRethinkdbUrl(credentials.uri);
let connection;

// Within the credentials, an entry ca_certificate_base64 contains the SSL pinning key
// We convert that from a string into a Buffer entry in an array which we use when
// connecting.
let caCert = new Buffer(credentials.ca_certificate_base64, 'base64');

// Now we can insert the SSL credentials
options.ssl = {
    ca: caCert
};

r.connect(options).then(function(conn) {
  connection = conn;
}).then(function(x) {
  return r.dbList().contains("grand_tour").do(
      function(exists) {
          return r.branch(exists, { "dbs_created": 0 },
              r.dbCreate("grand_tour"));
      }).run(connection);
}).then(function(result) {
  if (result.dbs_created > 0) { console.log("DB created"); }
  return r.db("grand_tour").tableList().contains("words").do(
      function(exists) {
          return r.branch(exists, { "tables_created": 0 },
              r.db("grand_tour").tableCreate("words", { replicas: 3 })
          );
      }).run(connection);
}).then(function(result) {
  if (result.tables_created > 0) { console.log("Table created"); }
}).catch(function(err) {
  console.error(err);
});

// Add a word to the database
function addWord(word, definition) {
  return new Promise(function(resolve, reject) {
      r
          .db("grand_tour")
          .table("words")
          .insert({
              word: word,
              definition: definition
          })
          .run(connection, function(error, cursor) {
              if (error) {
                  reject(error);
              } else {
                  resolve(cursor);
              }
          });
  });
}

// Get words from the database
function getWords() {
  return new Promise(function(resolve, reject) {
      // we make a database request for the contents of the 'words' table
      // ordering the results alphabetically
      r
          .db("grand_tour")
          .table("words")
          .orderBy("word")
          .run(connection, function(err, cursor) {
              if (err) {
                  reject(err);
              } else {
                  // then we convert the response to an array and send it back to 'main.js'
                  cursor.toArray(function(err, results) {
                      if (err) {
                          reject(err);
                      } else {
                          resolve(results);
                      }
                  });
              }
          });
  });
}

// With the database going to be open as some point in the future, we can
// now set up our web server. First up we set it to server static pages
app.use(express.static(__dirname + "/public"));

// The user has clicked submit to add a word and definition to the database
// Send the data to the addWord function and send a response if successful
app.put("/words", function(request, response) {
  addWord(request.body.word, request.body.definition)
      .then(function(resp) {
          response.send(resp);
      })
      .catch(function(err) {
          console.log(err);
          response.status(500).send(err);
      });
});

// Read from the database when the page is loaded or after a word is successfully added
// Use the getWords function to get a list of words and definitions from the database
app.get("/words", function(request, response) {
  getWords()
      .then(function(words) {
          response.send(words);
      })
      .catch(function(err) {
          console.log(err);
          response.status(500).send(err);
      });
});

// Listen for a connection.
app.listen(port, function() {
  console.log("Server is listening on port " + port);
});