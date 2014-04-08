/**
 * Storage:
 *  - Persistent:
 *
 *      {
 *        mode: {
 *          #scopeX:
 *          ....
 *        },
 *        token: {
 *          #scopeX:
 *            ...
 *        },
 *        client_information: {
 *          #scopeX: {
 *            client_id:
 *            client_secret:
 *            ....
 *          }
 *        }
 *
 *      }
 *
 *
 */



var appViews = {

  switchView: function(name, body) {
    $('#display-title').html(name);
    $('#display').html(body);
  },

  deviceOff: function() {
    var html = new EJS({url: 'views/device-off.ejs'}).render({});
    this.switchView('device_off', html);
  },

  channelList: function(channelArray) {
    var html = new EJS({url: 'views/channel-list.ejs'}).render({
      channels: channelArray
    });
    this.switchView('channel_list', html);
  },

  displayModeSelection: function(availableModes) {
    var html = new EJS({url: 'views/mode-selection.ejs'}).render({availableModes: availableModes});
    this.switchView('mode_selection', html);
  },

  displayUserCode: function(userCode, verificationUri) {
    var html = new EJS({url: 'views/user-code.ejs'}).render({
      user_code: userCode, verification_uri: verificationUri
    });
    this.switchView('user_code', html);
  },

  displayProgress: function(message) {
    var html = new EJS({url: 'views/progress.ejs'}).render({
      'message': message
    });
    this.switchView('Progress: '+ message, html);
  },

  successfulPairing: function(accessToken, mode) {
    var html = new EJS({url: 'views/success.ejs'}).render({
      message: 'The device is in ' + mode + '. Here is the access token: '+ accessToken
    });
    this.switchView('Device paired', html);
  },

  tag: function(channel) {
    var html = new EJS({url: 'views/tag.ejs'}).render({
      message: 'You are listening to: ' + channel.name
    });
    this.switchView('Tags', html);
  },

  error: function(errorMessage) {
    var html = new EJS({url: 'views/error.ejs'}).render({
      message: errorMessage
    });
    this.switchView('error', html);
  }
};


var appFsm = new machina.Fsm({

  initialize: function() {

    var self = this;
    $('#power_btn').click(function() { self.handle('switch_on'); });
    $('#reset_btn').click(function() {
      storage.reset();
      Logger.info('**** RESET STORAGE ****');
      self.transition('DEVICE_OFF');
    });

    self.on('*', function(message, options) {
      if(message === 'transition') {
        if(options.action) {
          Logger.debug('[FSM] ', message, ': ', options.fromState, ' -> ', options.action, ' -> ', options.toState );
        } else {
          Logger.debug('[FSM] ', message, ': ', options.fromState, ' -> ', options.toState );
        }
      }
    });
  },

  getCurrentChannel: function() {
    var currentChannelName = storage.volatile.get('current_channel');
    return storage.volatile.getValue('channels', currentChannelName);
  },

  setCurrentChannel: function(channelName) {
    storage.volatile.put('current_channel', channelName);
  },

  setCurrentParam: function(param, value) {
    var currentChannelName = storage.volatile.get('current_channel');
    var channel = storage.volatile.getValue('channels', currentChannelName);
    channel[param] = value;
    storage.volatile.setValue('channels', currentChannelName, channel);
  },


  getMode: function(scope, mode) {
    return storage.persistent.getValue('mode', scope);
  },

  setMode: function(scope, mode) {
    storage.persistent.setValue('mode', scope, mode);
  },

  getToken: function(scope) {
    return storage.persistent.getValue('token', scope);
  },

  setToken: function(scope, mode, token) {
    token.mode = mode;
    storage.persistent.setValue('token', scope, token);
  },

  getAssociationCode: function(apBaseUrl) {
    return storage.persistent.getValue('association_code', apBaseUrl);
  },

  setAssociationCode: function(apBaseUrl, scope, verificationUrl, deviceCode, userCode, interval, expiresIn) {
    storage.persistent.setValue('association_code', apBaseUrl, {
      scope: scope,
      verification_url: verificationUrl,
      device_code: deviceCode,
      user_code: userCode,
      interval: interval,
      expires_in: expiresIn
    });
  },

  getClientInformation: function(apBaseUrl) {
    return storage.persistent.getValue('client_information', apBaseUrl);
  },

  setClientInformation: function(apBaseUrl, clientId, clientSecret) {
    storage.persistent.setValue('client_information', apBaseUrl, {
      client_id: clientId,
      client_secret: clientSecret
    });
  },

  error: function(err) {
    Logger.error(err);
    appViews.error(err.message);
    this.transition('ERROR');
  },

  initialState: 'DEVICE_OFF',

  states : {

    'DEVICE_OFF': {
      _onEnter: function() {
        appViews.deviceOff();
      },

      'switch_on': function() {
        this.transition('SCANNING');
      }
    },

    'SCANNING': {
      _onEnter: function() {
        appViews.displayProgress('Scanning...');

        this.handle('getChannelList');

      },
      'getChannelList': function() {
        var channels = [];
        for(var channelName in config.scopes) {
          var channel = {
            name: channelName,
            scope: config.scopes[channelName],
            ap_base_url: null,
            available_modes: {}
          };

          storage.volatile.setValue('channels', channelName, channel);
        }

        var self = this;
        setTimeout(function() {
          var channelList = storage.volatile.get('channels');
          if(!channelList || channelList.length === 0) {
            return self.error({message: 'Unable to discover any channel'});
          }
          self.transition('CHANNEL_LIST');
        }, 100);
      }
    },

    'CHANNEL_LIST': {
      _onEnter: function() {
        var channels = storage.volatile.get('channels');

        var channelArray = [];
        for (var k in channels) {
          channelArray.push(channels[k]);

        }
        appViews.channelList(channelArray);

        var self = this;
        $('.channel-list>a').click(function() {
          self.handle('onChannelClick',  $(this).attr('data-channel'), $(this).attr('data-scope'));
        });
      },

      'onChannelClick': function(channelName, scope) {
        var self = this;

        self.setCurrentChannel(channelName);
        var channel = self.getCurrentChannel();

        if (!channel.ap_base_url) {
          self.transition('AP_DISCOVERY');
        }
        else if (! self.getClientInformation(channel.ap_base_url)) {
          self.transition('CLIENT_REGISTRATION');
        }
        else {
          if (self.getToken(channel.scope)) {
            self.transition('TAG');
          } else {
            self.transition('MODE_SELECTION');
          }
        }
      }
    },

    'AP_DISCOVERY': {
      _onEnter: function() {

        var self = this;
        var channel = self.getCurrentChannel();

        cpaProtocol.getAPInfos(channel.scope, function(err, apBaseUrl, availableModes) {
          if(err) {
            return self.error(err);
          }
          self.setCurrentParam('ap_base_url', apBaseUrl);
          self.setCurrentParam('available_modes', availableModes);
          if(self.getClientInformation(apBaseUrl) !== null) {
            self.transition('MODE_SELECTION');
          } else {
            self.transition('CLIENT_REGISTRATION');
          }
        });
      }
    },

    'CLIENT_REGISTRATION': {
      _onEnter: function() {
        appViews.displayProgress('Client registration');

        var self = this;
        var channel = self.getCurrentChannel();

        cpaProtocol.registerClient(channel.ap_base_url, 'Demo Client', 'cpa-client', '1.0.2', function(err, clientId, clientSecret) {
          if(err) {
            return error(err);
          }

          self.setClientInformation(channel.ap_base_url, clientId, clientSecret);

          self.transition('MODE_SELECTION');
        });
      }
    },

    'MODE_SELECTION': {
      _onEnter: function() {
        var self = this;
        var channel = self.getCurrentChannel();
        var mode = self.getMode(channel.scope);
        console.log('MODE', mode);
        if (mode === 'USER_MODE') {
          if (self.getToken(channel.scope)) {
            self.transition('TAG');
          } else {
            var associationCode = self.getAssociationCode(channel.ap_base_url);
            if (!associationCode) {
              self.transition('AUTHORIZATION_INIT');
            } else {
              self.transition('AUTHORIZATION_PENDING');
            }
          }
        }
        else if (mode === 'CLIENT_MODE') {
          if (self.getToken(channel.scope)) {
            self.transition('TAG');
          } else {
            self.transition('CLIENT_AUTH_INIT');
          }
        }
        else {
          appViews.displayModeSelection(channel.available_modes);

          var self = this;
          $('a.list-group-item').click(function() {
            self.handle('onModeClick',  $(this).attr('data-mode'));
          });
        }
      },

      'onModeClick': function(mode) {
        var self = this;

        var channel = self.getCurrentChannel();

        self.setMode(channel.scope, mode);


        if(mode === 'USER_MODE') {
          self.transition('AUTHORIZATION_INIT');
        }
        else if(mode === 'CLIENT_MODE') {
          self.transition('CLIENT_AUTH_INIT');
        }
        else {
          return self.error(new Error('Unknown mode'));
        }

      }
    },

    'AUTHORIZATION_INIT': {
      _onEnter: function() {
        var self = this;

        var channel = self.getCurrentChannel();
        var clientInformation = self.getClientInformation(channel.ap_base_url);
        var associationCode = self.getAssociationCode(channel.ap_base_url);

        if (!associationCode){
          cpaProtocol.requestUserCode(channel.ap_base_url,
            clientInformation.client_id,
            clientInformation.client_secret,
            channel.scope,
            function(err, data){
              if(err) {
                return self.error(err);
              }

              self.setAssociationCode(channel.ap_base_url,
                channel.scope,
                data.verification_uri,
                data.device_code,
                data.user_code,
                data.interval,
                data.expires_in
              );

              self.transition('AUTHORIZATION_PENDING');
            });
        } else {
          self.transition('AUTHORIZATION_PENDING');
        }

      }
    },

    'CLIENT_AUTH_INIT': {
      _onEnter: function() {
        var self = this;

        var channel = self.getCurrentChannel();
        var clientInformation = self.getClientInformation(channel.ap_base_url);

        cpaProtocol.requestClientAccessToken(channel.ap_base_url,
          clientInformation.client_id,
          clientInformation.client_secret,
          channel.scope,
          function(err, clientModeToken){
            if(err) {
              return self.error(err);
            }
            self.setToken(channel.scope, 'CLIENT_MODE', clientModeToken);
            self.transition('SUCCESSFUL_PAIRING');
        });
      }
    },

    'AUTHORIZATION_PENDING': {
      _onEnter: function(){
        var self = this;

        var channel = self.getCurrentChannel();
        var associationCode = self.getAssociationCode(channel.ap_base_url);
        console.log(associationCode);
        appViews.displayUserCode(associationCode.user_code, associationCode.verification_url);
        $('#verify_code_btn').click(function() { self.handle('onValidatePairingClick'); });
      },

      'onValidatePairingClick': function() {
        this.transition('AUTHORIZATION_CHECK');
      }
    },

    'AUTHORIZATION_CHECK': {
      _onEnter: function() {
        var self = this;

        var channel = self.getCurrentChannel();
        var associationCode = self.getAssociationCode(channel.ap_base_url);
        var clientInformation = self.getClientInformation(channel.ap_base_url);

        cpaProtocol.requestUserAccessToken(channel.ap_base_url, clientInformation.client_id, clientInformation.client_secret,
          associationCode.device_code, channel.scope, function(err, userModeToken){
            if(err) {
              self.error(err);
            } else if(!userModeToken) {
              alert('Go to the website');
              self.transition('AUTHORIZATION_PENDING');
            } else {
              self.setToken(channel.scope, 'USER_MODE', userModeToken);
              self.transition('SUCCESSFUL_PAIRING');
            }
          });
      }
    },

    'SUCCESSFUL_PAIRING': {
      _onEnter: function() {
        var self = this;
        var channel = self.getCurrentChannel();
        var token = self.getToken(channel.scope);
        var mode = token.mode;

        appViews.successfulPairing(token.token, mode);

        $('#ok-btn').click(function(){
          self.transition('TAG');
        });

        $('#trig-without-btn').click(function(){
          requestHelper.get(channel.scope + 'resource', null)
            .success(function(data, textStatus, jqXHR) {
              Logger.info('Reply ' + jqXHR.status + '(' + textStatus + '): ', data);
              alert(data.message);
            })
            .fail(function(jqXHR, textStatus) {
              Logger.error('Reply ' + jqXHR.status + '(' + textStatus + '): ', 'invalid request');
              alert('invalid request');
            });
        });
      }
    },

    'TAG': {
      _onEnter: function() {
        var self = this;
        var channel = self.getCurrentChannel();
        var token = self.getToken(channel.scope);
        var mode = token.mode;

        appViews.tag(channel, mode);

        $('#tag-btn').click(function() {
          radioTag.tag(token, function(err, title, summary, author, publishedDate) {
            $('#message-panel').html('<h2>'+title+'</h2><address>'+summary+'</address>')
          });
        });
//
//        $('#trig-with-btn').click(function(){
//          requestHelper.get(channel.scope + 'resource', token.token)
//            .success(function(data, textStatus, jqXHR) {
//              Logger.info('Reply ' + jqXHR.status + '(' + textStatus + '): ', data);
//              alert(data.message);
//            })
//            .fail(function(jqXHR, textStatus) {
//              Logger.error('Reply ' + jqXHR.status + '(' + textStatus + '): ', 'invalid request');
//              alert('invalid request');
//            });
//        });

      }
    },

    'ERROR': {
      _onEnter: function() {
        Logger.error('end');
      }
    }
  }
});

//appFsm.handle('switch_on');
