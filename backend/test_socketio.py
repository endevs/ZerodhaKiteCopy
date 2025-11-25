#!/usr/bin/env python
"""Quick test to verify Socket.IO is working"""
# Monkey patch FIRST
try:
    import eventlet
    eventlet.monkey_patch()
    print("Using eventlet")
except ImportError:
    try:
        import gevent
        from gevent import monkey
        monkey.patch_all()
        print("Using gevent")
    except ImportError:
        print("Using threading")

from flask import Flask
from flask_socketio import SocketIO

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet' if 'eventlet' in str(type(socketio)) else 'threading')

@socketio.on('connect')
def test_connect():
    print("Client connected")

if __name__ == '__main__':
    print("Starting test server on http://localhost:8001")
    print("Test with: curl -I 'http://localhost:8001/socket.io/?EIO=4&transport=polling'")
    socketio.run(app, host='0.0.0.0', port=8001, debug=True)



