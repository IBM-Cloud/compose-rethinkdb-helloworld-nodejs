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

// First add the obligatory web framework
var express = require('express');
var app = express();

var bodyParser = require('body-parser');

app.use(bodyParser.urlencoded({
  extended: false
}));

// Util is handy to have around, so thats why that's here.
const util = require('util')
    // and so is assert
const assert = require('assert');

// We want to extract the port to publish our app on
var port = process.env.VCAP_APP_PORT || 8080;

// Then we'll pull in the database client library
var r = require("rethinkdb");

// Now lets get cfenv and ask it to parse the environment variable
var cfenv = require('cfenv');
var appenv = cfenv.getAppEnv();

// Within the application environment (appenv) there's a services object
var services = appenv.services;

// The services object is a map named by service so we extract the one for rethinkdb
var rethinkdb_services = services["compose-for-rethinkdb"];

// This check ensures there is a services for rethinkdb databases
assert(!util.isUndefined(rethinkdb_services), "Must be bound to compose-for-rethinkdb services");

// We now take the first bound rethinkdb service and extract it's credentials object
var credentials = rethinkdb_services[0].credentials;

// Within the credentials, an entry ca_certificate_base64 contains the SSL pinning key
// We convert that from a string into a Buffer entry in an array which we use when
// connecting.
var caCert = new Buffer(credentials.ca_certificate_base64, 'base64');

/// This is the rethinkdb connection. From the application environment, we got the
// credentials and the credentials contain a URI for the database. Here, we
// connect to that URI

var parseRethinkdbUrl = require('parse-rethinkdb-url');

var options = parseRethinkdbUrl(credentials.uri);

// Now we can insert the SSL credentials
options.ssl = {
    ca: caCert
};

var connection;

// make the database connection and create the 'examples' database
// if the database already exists RethinkDB returns an error, which will appear in the console
r.connect(options, function(error, conn) {
  if (error) throw error;
  else {
    connection = conn;
    r.dbCreate("examples").run(connection);
    r.db("examples").tableCreate("words").run(connection);
  }

});

// With the database going to be open as some point in the future, we can
// now set up our web server. First up we set it to server static pages
app.use(express.static(__dirname + '/public'));

// When a user clicks 'add' we add their input to the 'words' table
app.put("/words", function(request, response) {
  r.db("examples").table("words").insert({
      "word": request.body.word,
      "definition": request.body.definition
  }).run(connection, function(error,cursor) {
    if (error) {
      response.status(500).send(error);
    } else {
      response.send("ok");
    }
  });
});

// Then we create a route to handle our example database call
app.get("/words", function(request, response) {

    // we make a database request for the contents of the 'words' table
    // ordering the results alphabetically
    r.db("examples").table("words").orderBy("word").run(connection, function(err, cursor) {

        if (err) throw err;

        // then we convert the response to an array and send it back to 'main.js'
        cursor.toArray(function(err, results) {
          if (err) throw err;
          response.send(results);
      });

    });

});


// Now we go and listen for a connection.
app.listen(port);

//require("cf-deployment-tracker-client").track();
