exports = module.exports = Gamer;

function Gamer() {
	if(!(this instanceof Gamer)) return new Gamer();
	
	this.uid = null;
	this.profile = {};
	this.room = null;
	this.seat = -1;
}

Gamer.prototype.setLink = function(server, socket, pin) {
	var gamer = this;
	var uid = gamer.uid;
	
	if(gamer.socket) gamer.removeLink();
	
	if(! socket.gamers) {
		socket.gamers = {};
		socket.gamers_count = 0;
		
		socket.on('rpc', function(req){
			//console.dir(req);
			if(typeof req !== 'object') return;
			
			var me = socket.gamers[ req.uid ];
			if(me && (typeof me === 'object') && (me.pin == req.pin) && (typeof req.f === 'string')) {
				var method = me[ req.f ];
				//console.dir(method);
				if(typeof method === 'function') {
					method.call(me, req.args, function(err, ret){
						//console.log(err, ret);
						socket.emit('rpc_ret', { seq: req.seq, err:err, ret:ret });
					});
					
				} else {
					var roomid = me.room;
					if(roomid) {
						delete req.pin;
						gamer.server.pub.publish('room:#'+roomid, JSON.stringify(req));
					} else {
						socket.emit('rpc_ret', { seq:req.seq, err:400, ret:'not in room'});
					}
				}
				
			} else {
				socket.emit('rpc_ret', { seq:req.seq, err:400, ret:'invalid rpc req'});
			}
		});
	}

	socket.gamers[ uid ] = gamer;
	socket.gamers_count ++;
	
	gamer.server = server;
	gamer.socket = socket;
	gamer.pin = pin;
	
	return this;
};

Gamer.prototype.removeLink = function() {
	var gamer = this;
	
	var socket = gamer.socket;
	if(socket) {
		delete socket.gamers[ gamer.uid ];
		socket.gamers_count --;
	}
	
	gamer.socket = null;
	gamer.server = null;
	gamer.pin = null;
	
	return this;
};

Gamer.prototype.push = function(event, args) {
	this.socket.emit('push', {
		uid: this.uid,
		e: event,
		args: args
	});
	
	return this;
};

Gamer.prototype.setProfile = function( p ) {
	this.uid = p.uid;
	this.profile = {
		uid: p.uid,
		name: p.name,
		avatar: p.avatar,
		coins: p.coins,
		score: p.score,
		exp: p.score,
		level: p.level
	};
	
	return this;
};

Gamer.prototype.getProfile = function() {
	return this.profile;
};

Gamer.prototype.onLogin = function(){
	console.log('gamer on login');
	var gamer = this;
	gamer.server.sub.subscribe('user:#' + gamer.uid);
};

Gamer.prototype.onDrop = function() {
	var gamer = this;
	if(gamer.room) {
		var room_key = 'room:#' + this.room;
		gamer.server.pub.publish(room_key, JSON.stringify({
			uid: gamer.uid,
			f: 'drop',
			seq: 0,
			args: null
		}));
	}
	gamer.server.sub.unsubscribe('user:#' + this.uid);
};

Gamer.prototype.onRelogin = function() {
	console.log('gamer on re-login');
	var gamer = this;
	gamer.server.sub.subscribe('user:#' + gamer.uid);
	if(gamer.room) {
		var room_key = 'room:#' + gamer.room;
		gamer.socket.join(room_key);
		gamer.server.pub.publish(room_key,JSON.stringify({
			uid: gamer.uid,
			f: 'relogin',
			seq: 0,
			args: null
		}));
	}
};

Gamer.prototype.onLogout = function() {
	var gamer = this;
	if(gamer.room) {
		var room_key = 'room:#' + gamer.room;
		gamer.server.pub.publish(room_key,JSON.stringify({
			uid: gamer.uid,
			f: 'logout',
			seq: 0,
			args: null
		}));
		gamer.socket.leave(room_key);
	}
	gamer.server.sub.unsubscribe('user:#' + gamer.uid);
};

Gamer.prototype.games = function(noargs, func) {
	var db = this.server.db;
	if(! db) { func(500, 'db err'); return; }
	
	var now = new Date().getTime();
	if(! db.cache) db.cache = {};
	var cache = db.cache;
	
	var list = cache['game:all'];
	var timestamp = cache['t_game:all'];
	if(list && timestamp && (now < timestamp +1000)) {
		func(0, list);
		
	} else {
		db.zrange('game:all', 0, -1, function(err,ret){
			if(err) { func(500, 'db err'); return; }
			if(! ret) { func(404, 'not found'); return; }
			
			var m = db.multi();
			for(var i=0, len=ret.length; i<len; i++){
				m.hgetall('game:#'+ret[i])
				.zcount('game:#'+ret[i]+'#rooms', now-5000, now);
			}
			m.exec(function(err,ret){
				//console.log(err, ret);
				if(err) { func(500, 'db err'); return; }
				var list = [];
				for(var i=0, len=ret.length; i<len; i+=2) {
					var game = ret[i];
					game.rooms = ret[i+1];
					list.push( game );
				}
				cache['game:all'] = list;
				cache['t_game:all'] = now;
				func(0, list);
			});
		});
	}
};

Gamer.prototype.rooms = function(gametype, func) {
	var db = this.server.db;
	if(! db) { func(500,'db err'); return; }
	
	var now = new Date().getTime();
	if(! db.cache) db.cache = {};
	var cache = db.cache;
	
	var rooms_key = 'game:#'+gametype+'#rooms';
	var list = cache[rooms_key];
	var timestamp = cache['t_'+rooms_key];
	if(list && timestamp && (now < timestamp +1000)) {
		func(null, list);
	} else {
		db.zrange(rooms_key, 0, -1, function(err,ret){
			if(err) return;
			if(! ret) return;
			var m = db.multi();
			for(var i=0, len=ret.length; i<len; i++){
				m.hgetall('room:#' + ret[i]);
			}
			m.exec(function(err,list){
				if(err) return;
				cache[rooms_key] = list;
				cache['t_'+rooms_key] = now;
				func(0, list);
			});
		});
	}
};

Gamer.prototype.enter = function(roomid, func) {
	var gamer = this;
	
	if(gamer.room) {
		func(400, 'already in room');
		return;
	}
	
	var db = this.server.db;
	var room_key = 'room:#' + roomid;
	db.hgetall(room_key, function(err,roominfo){
		if (err) {
			func(500, 'db err');
			return;
		}
		
		gamer.room = roomid;
		gamer.socket.join(room_key);
		gamer.server.pub.publish(room_key, JSON.stringify({
			f: 'enter',
			uid: gamer.uid, 
			seq: 0,
			args: roomid
		}));
		
		func(0, 'ok');
	});
};

Gamer.prototype.exit = function(noargs, func) {
	var gamer = this;
	
	var roomid = gamer.room;
	if(! roomid) {
		func(400, 'not in room');
		return;
	}
	
	var room_key = 'room:#' + roomid;
	gamer.server.pub.publish(room_key, JSON.stringify({
		f:'exit',
		uid: gamer.uid,
		seq: 0,
		args: null
	}));
	gamer.room = null;
	gamer.socket.leave(room_key);
	
	func(0, 'ok');
};

Gamer.prototype.say = function say( msg, func ) {
	var gamer = this;
	
	var roomid = gamer.room;
	if(! roomid) {
		func(400, 'not in room');
		return;
	}
	
	var room_key = 'room#' + roomid;
	gamer.server.io.to(room_key).emit('push', {
		uid: null,
		e: 'say',
		args: {
			who: {
				uid: gamer.uid,
				name: gamer.name
			},
			msg: msg
		}
	});
	
	func(0, 'ok');
};

Gamer.prototype.shout = function shout( msg, func ) {
	var gamer = this;
	
	gamer.server.io.emit('push', {
		uid: null,
		e: 'shout',
		args: {
			who: {
				uid: gamer.uid,
				name: gamer.name
			},
			msg: msg
		}
	});
};

Gamer.prototype.onMessage = function(message) {
	try {
		var req = JSON.parse(message);
		if(req && (typeof req === 'object')) {
			var socket = this.socket;
			switch(req.f) {
			case 'response':
				delete req.f;
				socket.emit('rpc_ret', req);
				break;
			case 'event':
				delete req.f;
				socket.emit('push', req);
				break;
			}
		}
	} catch( err ) {
		console.log(err);
	}
};

