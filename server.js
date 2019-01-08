const debug = require('debug')('dusgarage')
var express  = require('express');
var cookieParser = require('cookie-parser')
var bodyParser = require('body-parser')
var app   = express();
var request = require('request')
var http = require('http');
var server = http.createServer(app);
var io    = require('socket.io').listen(server);
var cron  = require('node-cron');
var fs    = require("fs");
var env = process.env.DUSGARAGE_CFG || "/tmp/dusgarage_cfg.js";
var cfg = require(env);
const {google} = require('googleapis');


var parkinglots;
var arrayOfStates;
var doorState = "UNKNOWN";
var isSecurityEnabled = cfg.SECURITY_ENABLED;
var fileSelfChanged = false;
var refreshTokens = new Object(); // Map - key: id_token value: refresh_token
// ------------- Init stuff ----------------
app.use(cookieParser());
app.use(bodyParser.json());


// ----------- BUSINESS LOGIC ----------
function getNextState(state) {
  debug("getNextState state=%j", state);

  for (i=0; i<arrayOfStates.length; i++ ) {
    if (state.name == arrayOfStates[i].name) {
      return arrayOfStates[(i+1) % arrayOfStates.length];
    }
  }

  // State not found: return first:
  return arrayOfStates[0];
}

function resetStates() {
  console.log('resetting all states to initial state %s', arrayOfStates[0].name);
  for (i=0; i<parkinglots.length; i++ ) {
    parkinglots[i].state = arrayOfStates[0];
  }
  parkinglotModified();
}

function parkinglotModified() {
  debug("Persisting state...")
  fileSelfChanged = true;

  fs.writeFile( cfg.CURRENT_STATE_FILE_PATH, JSON.stringify(parkinglots, null, 2), function(err) {
    fileSelfChanged = false;
     if (err) {
        return console.error(err);
     }
   });

   broadcastStateChange();
}

function checkDoorAvailability() {
  debug("checkDoorAvailability with URL %s", cfg.DOOR_URL_CHECK )

  var req = request.get(cfg.DOOR_URL_CHECK , {timeout: cfg.DOOR_TIMEOUT}, function(err, res, body) {
    debug('response');
    if (!err && res.statusCode == 200) {
      handleNewDoorState("ONLINE");
    } else{
      debug("err=%s", err)
      handleNewDoorState("OFFLINE");
    }
  });
}

function handleNewDoorState(newDoorState) {
  if (newDoorState !== doorState) {
    doorState = newDoorState;
    debug("Broadcast new door state %s to %s connected clients...", doorState, io.engine.clientsCount)
    io.sockets.emit('updateDoor', doorState);
  }

}


// ----------- REST SERVICES ----------

app.get('/parkinglots', function (req, res) {
    debug("get parkinglots")
    res.end( JSON.stringify(parkinglots));
})
app.get('/parkinglots/:id', function (req, res) {
  debug("get parkinglots id=%s", req.params.id)
  res.end( JSON.stringify(parkinglots[req.params.id]));
})

app.post('/parkinglots/:id', ensureAuthenticated, function (req, res) {
  debug("post parkinglots id=%s", req.params.id);
  parkinglot = parkinglots[req.params.id];
  oldState = parkinglot.state;
  newState = getNextState(oldState);
  modified = false;

  if (newState.name == "FREE") {
    // Only the current owner can free his parking lot:
    if (isSecurityEnabled==false || parkinglot.user == req.user) {
      parkinglot.user = "-nobody-";
      parkinglot.state = newState;
      modified = true;
    }
  } else if (newState.name == "RESERVED") {
    if (isSecurityEnabled) {
      parkinglot.user = req.user;
    } else {
      parkinglot.user = "-unknown-";
    }
    parkinglot.state = newState;
    modified = true;
  } else if (newState.name == "OCCUPIED") {
      // Only user with reservation can occupy:
      if (isSecurityEnabled==false || parkinglot.user == req.user) {
         parkinglot.state = newState;
         modified = true;
    }
  }

  if (modified)
    parkinglotModified();

  res.end( JSON.stringify(parkinglot));
});

app.post('/openDoor', ensureAuthenticated, function (req, resClient) {
  debug("post openDoor");
  var req = request.post(cfg.DOOR_URL_OPEN, {timeout: cfg.DOOR_TIMEOUT}, function(err, res, body) {
    debug('response');
    if (!err && res.statusCode == 200) {
      resClient.status(200).json({ message: "OK" });
      handleNewDoorState("ONLINE");
    } else{
      resClient.status("503").json({ message: err });
      handleNewDoorState("OFFLINE");
    }
    resClient.end();
  });

});


// ----------- PAGES SERVICES ----------

app.get('/', ensureAuthenticated, function (req, res) {
	res.sendFile(__dirname + '/client.html');
});
app.get('/error', function (req, res) {
	res.status("400").sendFile(__dirname + '/error.html');
});

app.get('/logout', function (req, res) {
  res.clearCookie("bearer");
  res.redirect("/");
});

app.get('/health', function(req, res){
  res.send('1');
});
app.get('/ready', function(req, res){
  res.send('1');
});


// ------------- Websocket stuff: ----------------

io.sockets.on('connection', function (socket) {
  debug("websocket client connected");
  // Send update to this client in case client was disconnected for a long time
  // and state has changed meanwhile:
  socket.emit('updateLots', parkinglots);
  socket.emit('updateDoor', doorState);

  socket.on('disconnect', function () {
    debug("websocket client disconnect");
  });
});

function broadcastStateChange() {
  debug("Broadcast state change to %s connected clients...", io.engine.clientsCount)
  io.sockets.emit('updateLots', parkinglots);
}


// ------------- Authentication stuff: ----------------
console.log("Setting up google authentication with security enabled = %s...", isSecurityEnabled);

const oauth2Client = new google.auth.OAuth2(
  cfg.GOOGLE_CLIENT_ID,
  cfg.GOOGLE_CLIENT_SECRET,
  cfg.GOOGLE_CALLBACK_URL
);
var authurl = oauth2Client.generateAuthUrl({
  scope: [
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile'
  ],
  access_type: 'offline'
});

app.get('/auth/google', function(req, res){
  debug("auth/google: server side redirect to %s", authurl);
  res.redirect(authurl);
});

oauth2Client.on('tokens', (tokens) => {
  debug("oauth2 client on tokens event received.  tokens=%s", JSON.stringify(tokens));
  if (tokens.refresh_token && tokens.id_token) {
    debug("did receive a new  refresh_token for an id_token - remember it");
    refreshTokens[tokens.id_token]  = tokens.refresh_token;
    fs.writeFile( cfg.REFRESH_TOKENS_FILE_PATH, JSON.stringify(refreshTokens, null, 2));
  }
});

app.get('/auth/google/callback', function(req, res){
  debug("oauth2callback");
  var code = req.query.code;
  debug("code = %s", code);

  oauth2Client.getToken(code, function(err, tokens) {
      debug("getToken: err=%s, tokens=%s", err, JSON.stringify(tokens));

      if (err) {
        msg = "getToken failed with error " +err;
        debug(msg);
        res.redirect("/error?msg="+msg);
      } else {
        debug("Storing id_token in cookie");
        res.cookie("id_token", tokens.id_token, { expires: new Date(Date.now() + 1000*60*60*24*365), httpOnly:true });

        // Send back the token to the client in URL
        res.redirect("/");
      }
  });
});

function ensureAuthenticated(req, res, next) {
  debug("ensureAuthenticated isSecurityEnabled=%s", isSecurityEnabled);

  if (isSecurityEnabled == true) {
    if (req.cookies.id_token) {
      id_token = req.cookies.id_token;
      debug("id_token: %s", id_token);


      // verify id_token is present:
       oauth2Client.verifyIdToken({
          idToken: id_token,
          audience: cfg.GOOGLE_CLIENT_ID,
      }, function (err, response) {
        if (err) {
          msg = "verifyIdToken failed with error" + err;
          debug(msg);

          if (err.message.indexOf("Token used too late") !== -1) {
            refresh_token = refreshTokens[id_token];

            debug("Trying to refresh access token with refresh_token %s", refresh_token);
            oauth2Client.setCredentials({refresh_token: refresh_token});
            delete refreshTokens[id_token];

            // Token is expired, need to refresh:
            oauth2Client.refreshAccessToken(function (err, tokens){
              if (err) {
                msg = "refreshAccessToken failed with error " + err;
                console.log(msg);
                res.redirect("/error?msg="+msg);
              } else {
                console.log("refreshAccessToken success.");
                id_token = tokens.id_token;
                refreshTokens[id_token]= refresh_token;
                fs.writeFile( cfg.REFRESH_TOKENS_FILE_PATH, JSON.stringify(refreshTokens, null, 2));
                res.cookie("id_token", id_token, { expires: new Date(Date.now() + 1000*60*60*24*365), httpOnly:true });
                oauth2Client.verifyIdToken({
                   idToken: id_token,
                   audience: cfg.GOOGLE_CLIENT_ID,
                }, function (err, response) {
                   if (err) {
                     console.log("VerificationOfAFreshlyRenewedIdTokenShouldNeverEverFail: " + err);
                     res.redirect("/error?msg=VerificationOfAFreshlyRenewedIdTokenShouldNeverEverFail");
                   } else {
                    req.user = response.getPayload()['name'];
                    return next();
                   }
                 }
               );
             }});
           } else {
             res.redirect("/error?msg="+msg);
           }
        } else {
          debug("verifyIdToken success! response=%s", response);

          const payload = response.getPayload();
          debug("payload: %s", JSON.stringify(payload));

          req.user = payload['name'];
          debug("req.user: %s", req.user);
          return next();
        }
      });
    } else {
      msg = "No id_token Cookie found";
      debug(msg);
      res.redirect("/error?msg="+msg);
    }
  } else {
    debug("security is disabled");
    return next();
  }
}

function readParkingLotsFromFile() {
  console.log("Reading parkinglots from "+cfg.CURRENT_STATE_FILE_PATH+"...")
  return fs.readFile( cfg.CURRENT_STATE_FILE_PATH, 'utf8', function (err, data) {
      if (err || data == null || data.length < 16) {
        console.log("... failed! err=%s, data=%s", err, data);
        return false;
      } else {
        parkinglots = JSON.parse(data)
        return true;
      }
  });
}

// ------------- INIT ----------------
readParkingLotsFromFile();

console.log("Watching parkinglots...");
fs.watch(cfg.CURRENT_STATE_FILE_PATH, function (event, filename) {
    debug('Parkinglots changed on disc. filename=%s, Event=%s, selfChanged=%s ',filename, event, fileSelfChanged);
    if (filename && event=="change" && !fileSelfChanged) {
        console.log("Parkingslots changed on disc - refreshing...");
        readParkingLotsFromFile();
        broadcastStateChange();
    }
});

console.log("Reading states...")
fs.readFile( __dirname + "/" + "states.json", 'utf8', function (err, data) {
    arrayOfStates = JSON.parse(data)
});


if (isSecurityEnabled) {
  console.log("Reading refresh tokens...")
  fs.readFile(cfg.REFRESH_TOKENS_FILE_PATH, 'utf8', function (err, data) {
      if (err) {
        console.log("Reading refresh_tokens...failed with err %s", err);
      } else {
        refreshTokens = JSON.parse(data)
      }
  });
}


console.log("Creating server socket...")
server.listen(cfg.SERVER_PORT);

console.log("Scheduling cronjobs....")
 // ss mm hh day month dayOfWeek
cron.schedule(cfg.CRON_RESET_LOTS, function(){
  resetStates()
});

cron.schedule(cfg.CRON_DOOR_CHECK, function(){
  checkDoorAvailability()
});

console.log("Server startup completed! Listening at http://%s:%s", server.address().address, server.address().port)
