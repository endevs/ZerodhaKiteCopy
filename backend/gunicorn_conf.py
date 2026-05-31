# Gunicorn + gthread for Flask-SocketIO compatibility.
# Run: gunicorn -c gunicorn_conf.py app:app

worker_class = "gthread"
workers = 1
threads = 4
bind = "0.0.0.0:8003"
timeout = 600
graceful_timeout = 120
accesslog = "-"
errorlog = "-"


def post_worker_init(worker):
    import logging

    log = logging.getLogger("gunicorn.post_worker")
    try:
        from options_scheduler import start_scheduler

        if start_scheduler():
            log.info("options_scheduler: started")
    except Exception as e:
        log.warning("options_scheduler: %s", e)
    try:
        from app import _register_auto_auth_scheduler

        _register_auto_auth_scheduler()
        log.info("auto_auth_scheduler: started")
    except Exception as e:
        log.warning("auto_auth_scheduler: %s", e)
