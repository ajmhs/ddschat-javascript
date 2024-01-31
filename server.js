const express = require('express');
const app = express();

app.use(express.static(__dirname));

const bodyParser = require('body-parser')
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: false}))
app.use(require('cors')())

const http = require('http').Server(app);

const server = app.listen(3000, () => {
    console.log('server is running on port', server.address().port);
});
const io = require('socket.io')(server);

const argv = require('minimist')(process.argv.slice(2));

const _user = argv['u']
const _group = argv['g']
process.env['user'] = _user
process.env['group'] = _group

const path = require('path');
const configFile = path.join(__dirname, '/chatcfg.xml')

const rti = require('rticonnextdds-connector');
const connector = new rti.Connector('Chat_ParticipantLibrary::ChatParticipant', configFile);
const user_output = connector.getOutput('ChatUserPublisher::ChatUser_Writer');
const message_output = connector.getOutput('ChatMessagePublisher::ChatMessage_Writer');
const inputs = [
    connector.getInput('ChatUserSubscriber::ChatUser_Reader'),
    connector.getInput('ChatMessageSubscriber::ChatMessage_Reader')]

// Register the user instance
user_output.clearMembers();
user_output.instance.setString('username', _user);
user_output.instance.setString('group', _group);
user_output.instance.setString('firstName', '');
user_output.instance.setString('lastName', '');
user_output.write();

app.post('/messages', async (req, res) => {
    try {
        message_output.clearMembers();
        message_output.instance.setString('fromUser', _user);
        message_output.instance.setString('toUser', req.body['username'])
        message_output.instance.setString('toGroup', req.body['username'])
        message_output.instance.setString('message', req.body['message'])
        message_output.write();
      
        console.log('Message Posted')
        res.sendStatus(200);        
    }
    catch (error) {
      res.sendStatus(500);
      return console.log('error',error);
    }
    finally {
      // Anything?
    }
});

app.get('/users', async (req, res) => {
    try {
        
        var users = [];
        inputs[0].read();
        for (const sample of inputs[0].samples) {
            if (sample.validData) {
                if ('ALIVE' == sample.info.get('instance_state')) {
                    users.push(sample.getJson());
                }
            }
        }
        res.send(users);
    }
    catch (error) {
        res.sendStatus(500);
        return console.log('error',error)
    }
    finally {
        // Anything?
    }
})

connector.on('on_data_available', () => {
    
    inputs[0].read();
    for (const sample of inputs[0].samples) {
        if (sample.validData) {
            if ('ALIVE' == sample.info.get('instance_state') &&
                'NOT_READ' == sample.info.get('sample_state')) {
                
                io.emit('addUser', sample.getJson());
                console.log("Added a chat user");
            }
        }
        else {
            if ('NOT_READ' == sample.info.get('sample_state') &&
                'NOT_ALIVE_NO_WRITERS' == sample.info.get('instance_state')) {
            
                io.emit('delUser', sample.getJson());
                console.log("Removed a chat user");
            }
        }
    }

    inputs[1].take();
    for (const sample of inputs[1].samples.validDataIter) {
        io.emit('message', sample.getJson())
    }
})

io.on('connection', () =>{
    console.log('a user is connected')
})

process.on('exit', function () {
    console.log('About to exit, waiting for remaining connections to complete');
    user_output.instance.setString("username", _user)
    user_output.write(action="unregister")
    app.close();
});
