"""
Options Data Collection Scheduler
Runs daily to collect and store option data after market close
"""
import logging
import datetime
import time
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from options_data_collector import run_daily_collection

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

scheduler = BackgroundScheduler()


def daily_collection_job():
    """Job to run daily data collection"""
    try:
        logger.info("="*60)
        logger.info("Starting scheduled daily data collection")
        logger.info("="*60)
        
        # Collect data for yesterday (market closed)
        yesterday = datetime.date.today() - datetime.timedelta(days=1)
        
        results = run_daily_collection(date=yesterday)
        
        logger.info("="*60)
        logger.info("Scheduled collection results:")
        for index, success in results.items():
            status = "✓ SUCCESS" if success else "✗ FAILED"
            logger.info(f"  {index}: {status}")
        logger.info("="*60)
        
    except Exception as e:
        logger.error(f"Error in scheduled collection job: {e}", exc_info=True)


def start_scheduler():
    """Start the scheduler (safe to call more than once; no-op if already running)."""
    try:
        if scheduler.running:
            return True
        # Schedule daily job at 4:00 PM IST (after market close)
        # Note: APScheduler uses system timezone, adjust as needed
        scheduler.add_job(
            daily_collection_job,
            trigger=CronTrigger(hour=16, minute=0),  # 4:00 PM
            id='daily_options_collection',
            name='Daily Options Data Collection',
            replace_existing=True
        )
        
        scheduler.start()
        logger.info("✓ Options data collection scheduler started")
        logger.info("  Scheduled to run daily at 4:00 PM")
        
        return True
    except Exception as e:
        logger.error(f"Error starting scheduler: {e}", exc_info=True)
        return False


def stop_scheduler():
    """Stop the scheduler"""
    try:
        if scheduler.running:
            scheduler.shutdown()
            logger.info("Options data collection scheduler stopped")
    except Exception as e:
        logger.error(f"Error stopping scheduler: {e}", exc_info=True)


if __name__ == '__main__':
    # For testing: run collection immediately
    logger.info("Running test collection...")
    daily_collection_job()
    
    # Then start scheduler
    logger.info("\nStarting scheduler...")
    start_scheduler()
    
    try:
        # Keep script running
        while True:
            time.sleep(60)
    except KeyboardInterrupt:
        logger.info("Stopping scheduler...")
        stop_scheduler()
