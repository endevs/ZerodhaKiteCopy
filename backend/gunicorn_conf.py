# Gunicorn + eventlet for Flask-SocketIO (single worker).
# Run: gunicorn -c gunicorn_conf.py app:app

worker_class = "eventlet"
workers = 1
bind = "0.0.0.0:8003"
timeout = 120
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
