# CRITICAL: Monkey patch must be done BEFORE importing Flask or any other modules
# Try eventlet first, fallback to gevent, then threading
try:
    import eventlet
    eventlet.monkey_patch()
    ASYNC_MODE = 'eventlet'
except ImportError:
    try:
        import gevent
        from gevent import monkey
        monkey.patch_all()
        ASYNC_MODE = 'gevent'
    except ImportError:
        ASYNC_MODE = 'threading'

from flask import Flask, request, redirect, render_template, jsonify, session, flash, has_request_context
import os
import re
import json
from pathlib import Path
from flask_cors import CORS
from flask_socketio import SocketIO, emit
from kiteconnect import KiteConnect
from kiteconnect import exceptions as kite_exceptions
import logging
import random
import time
from collections import Counter
from threading import Thread, Lock
from typing import Dict, List, Tuple, Any, Optional, Callable, Set
from strategies.orb import ORB
from strategies.capture_mountain_signal import CaptureMountainSignal
from rules import load_mountain_signal_pe_rules
from ticker import Ticker
import uuid
import sqlite3
from sqlite3 import OperationalError as SqliteOperationalError
import smtplib, ssl
import socket
import math
import numbers
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
import datetime
import calendar
import secrets
import config
import requests
from requests.exceptions import (
    RequestException,
    ConnectionError as RequestsConnectionError,
    Timeout as RequestsTimeout,
)
from database import get_db_connection
from live_trade import (
    ensure_live_trade_tables,
    create_deployment as live_create_deployment,
    get_deployment_for_user as live_get_deployment_for_user,
    get_deployments_for_processing as live_get_deployments_for_processing,
    update_deployment as live_update_deployment,
    delete_deployment as live_delete_deployment,
    STATUS_SCHEDULED,
    STATUS_ACTIVE,
    STATUS_PAUSED,
    STATUS_STOPPED,
    STATUS_ERROR,
)

# Constants for market instruments
BANKNIFTY_SPOT_SYMBOL = 'NSE:NIFTY BANK'
NIFTY_SPOT_SYMBOL = 'NSE:NIFTY 50'
IST = datetime.timezone(datetime.timedelta(hours=5, minutes=30))
from chat import chat_bp
from utils.backtest_metrics import calculate_all_metrics
from ai_ml import train_lstm_on_candles, load_model_and_predict, load_lstm_checkpoint
from ai_ml import candles_to_dataframe, prepare_training_data
try:
    from rl_trading import train_rl_agent, evaluate_rl_agent
    RL_AVAILABLE = True
    logging.info("[RL] RL module loaded successfully")
except ImportError as e:
    logging.warning(f"RL module not available: {e}")
    RL_AVAILABLE = False
    # Create dummy functions to prevent errors
    def train_rl_agent(*args, **kwargs):
        raise RuntimeError("RL module not available. Install PyTorch.")
    def evaluate_rl_agent(*args, **kwargs):
        raise RuntimeError("RL module not available. Install PyTorch.")
import numpy as np
import torch

try:
    from groq import Groq
except ImportError:
    Groq = None


RETRYABLE_ERROR_KEYWORDS = (
    "timed out",
    "connection aborted",
    "connection reset",
    "temporarily unavailable",
    "temporary failure",
    "gateway timeout",
    "max retries exceeded",
    "read timeout",
)


def _is_retryable_exception(exc: Exception) -> bool:
    if isinstance(exc, (kite_exceptions.NetworkException, RequestsConnectionError, RequestsTimeout, RequestException, socket.timeout)):
        return True
    message = str(exc).lower()
    return any(keyword in message for keyword in RETRYABLE_ERROR_KEYWORDS)


def execute_with_retries(description: str, func: Callable[[], Any], *, max_attempts: int = 3, base_delay: float = 1.5) -> Any:
    """
    Execute a callable with automatic retries for transient Kite/HTTP errors.
    Raises TokenException immediately so the caller can handle re-auth flows.
    """
    last_exc: Optional[Exception] = None
    for attempt in range(1, max_attempts + 1):
        try:
            return func()
        except kite_exceptions.TokenException as exc:
            logging.error(f"{description} failed due to invalid Kite session: {exc}")
            raise
        except Exception as exc:
            last_exc = exc
            if not _is_retryable_exception(exc) or attempt == max_attempts:
                logging.error(f"{description} failed on attempt {attempt}/{max_attempts}: {exc}")
                raise
            delay = base_delay * attempt
            logging.warning(f"{description} transient error (attempt {attempt}/{max_attempts}): {exc}. Retrying in {delay:.1f}s")
            time.sleep(delay)
    if last_exc:
        raise last_exc


def _safe_float(value: Any) -> Optional[float]:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _simplify_for_json(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (datetime.datetime, datetime.date)):
        return value.isoformat()
    if isinstance(value, numbers.Integral):
        return int(value)
    if isinstance(value, numbers.Real):
        numeric_value = float(value)
        if math.isnan(numeric_value) or math.isinf(numeric_value):
            return None
        return numeric_value
    if isinstance(value, dict):
        return {str(key): _simplify_for_json(val) for key, val in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_simplify_for_json(item) for item in value]
    return str(value)


def _format_live_audit_event(event: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not isinstance(event, dict):
        return None

    event_type_raw = event.get('event_type') or event.get('type') or ''
    event_type = str(event_type_raw).lower()
    message_raw = (event.get('message') or '').strip()
    raw_details = event.get('data') or event.get('details') or {}
    if not isinstance(raw_details, dict):
        raw_details = {}
    details = _simplify_for_json(raw_details)

    category = 'audit'
    level = 'info'
    formatted_message = message_raw

    if event_type == 'signal_identified':
        category = 'signal_identified'
        level = 'info'
        signal_type = str(raw_details.get('signal_type') or '').upper()
        candle_window = raw_details.get('candle_time') or ''
        high = _safe_float(raw_details.get('high'))
        low = _safe_float(raw_details.get('low'))
        rsi = _safe_float(raw_details.get('rsi'))
        descriptor_parts = [part for part in [signal_type, str(candle_window).strip()] if part]
        metric_parts = []
        if high is not None and low is not None:
            metric_parts.append(f"H {high:.2f} / L {low:.2f}")
        if rsi is not None:
            metric_parts.append(f"RSI {rsi:.1f}")
        if descriptor_parts and metric_parts:
            formatted_message = f"Signal Identified — {' '.join(descriptor_parts)} | {', '.join(metric_parts)}"
        elif descriptor_parts:
            formatted_message = f"Signal Identified — {' '.join(descriptor_parts)}"
        elif metric_parts:
            formatted_message = f"Signal Identified — {', '.join(metric_parts)}"
        else:
            formatted_message = "Signal Identified"
    elif event_type == 'entry_blocked':
        category = 'signal_ignored'
        level = 'warning'
        reason = str(raw_details.get('reason') or '').replace('_', ' ').strip()
        if 'rsi' in message_raw.lower():
            reason_text = 'RSI condition not met'
        elif reason:
            reason_text = reason.capitalize()
        elif message_raw:
            reason_text = message_raw
        else:
            reason_text = 'Entry blocked'
        formatted_message = f"Ignored Signal — {reason_text}"
    elif event_type == 'entry':
        category = 'trade_entry'
        level = 'success'
        option_type = str(raw_details.get('option_type') or '').upper()
        instrument = raw_details.get('instrument') or raw_details.get('option_symbol') or ''
        entry_price = _safe_float(raw_details.get('entry_price') or raw_details.get('price'))
        descriptor = ' '.join(part for part in [option_type, str(instrument).strip()] if part)
        if entry_price is not None:
            price_text = f" @ {entry_price:.2f}"
        else:
            price_text = ''
        if descriptor:
            formatted_message = f"Trade Entry — {descriptor}{price_text}"
        else:
            formatted_message = f"Trade Entry{price_text}"
    elif event_type == 'stop_loss':
        category = 'trade_exit'
        level = 'danger'
        exit_price = _safe_float(raw_details.get('exit_price'))
        formatted_message = (
            f"Stop Loss Triggered — {exit_price:.2f}" if exit_price is not None else "Stop Loss Triggered"
        )
    elif event_type == 'target_hit':
        category = 'trade_exit'
        level = 'success'
        exit_price = _safe_float(raw_details.get('exit_price'))
        formatted_message = (
            f"Target Hit — {exit_price:.2f}" if exit_price is not None else "Target Hit"
        )
    elif event_type == 'market_close_square_off':
        category = 'trade_exit'
        level = 'info'
        formatted_message = "Square Off — Market close routine executed"
    elif event_type == 'exit':
        category = 'trade_exit'
        level = 'info'
        formatted_message = message_raw or "Position Exit"

    formatted_message = (formatted_message or '').strip()
    if not formatted_message:
        formatted_message = event_type.replace('_', ' ').title()

    return {
        'message': formatted_message,
        'category': category,
        'level': level,
        'meta': {
            'eventType': event_type,
            'details': details,
        }
    }


def round_to_atm_price(price: float, strike_step: int) -> int:
    if strike_step == 0:
        return int(price)
    return int(round(float(price) / strike_step) * strike_step)


def ensure_datetime(value: Any) -> datetime.datetime:
    if isinstance(value, datetime.datetime):
        return value
    if isinstance(value, datetime.date):
        return datetime.datetime.combine(value, datetime.time.min)
    if isinstance(value, str):
        try:
            return datetime.datetime.fromisoformat(value)
        except ValueError:
            for fmt in ('%Y-%m-%d %H:%M:%S', '%Y-%m-%d'):
                try:
                    return datetime.datetime.strptime(value, fmt)
                except ValueError:
                    continue
    return datetime.datetime.now()


def _parse_iso_date(value: Optional[str]) -> Optional[datetime.date]:
    if not value:
        return None
    try:
        return datetime.datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return None


def _fetch_candles_for_range(instrument_token: int, start_date: datetime.date, end_date: datetime.date, interval: str = "5minute") -> List[Dict[str, Any]]:
    candles: List[Dict[str, Any]] = []
    current_date = start_date
    total_days = (end_date - start_date).days + 1
    processed = 0
    while current_date <= end_date:
        start_dt = datetime.datetime.combine(current_date, datetime.time(9, 15))
        end_dt = datetime.datetime.combine(current_date, datetime.time(15, 30))
        try:
            hist = execute_with_retries(
                f"fetching {interval} historical data for token {instrument_token} on {current_date}",
                lambda: kite.historical_data(instrument_token, start_dt, end_dt, interval)
            )
            if hist:
                candles.extend(hist)
        except kite_exceptions.TokenException:
            raise
        except Exception as exc:
            logging.warning(f"[RL] Historical fetch failed for {current_date}: {exc}")
        current_date += datetime.timedelta(days=1)
        processed += 1
        if processed % 50 == 0 or current_date > end_date:
            logging.info(f"[RL] Fetch progress: {processed}/{total_days} days, candles collected: {len(candles)}")
    return candles


def _ensure_live_strategy_monitor(
    user_id: int,
    deployment_id: int,
    strategy_row: sqlite3.Row,
    *,
    access_token: Optional[str],
    config: Optional[Dict[str, Any]] = None,
    lot_count: Optional[int] = None,
) -> None:
    if not strategy_row or not access_token:
        return

    strategy_data = dict(strategy_row)
    strategy_type = (strategy_data.get('strategy_type') or '').lower()
    if strategy_type != 'capture_mountain_signal':
        return

    config = config or {}

    try:
        kite.set_access_token(access_token)
    except Exception as exc:
        logging.warning("Unable to set access token for live strategy monitor: %s", exc)

    for run_id, info in list(running_strategies.items()):
        if info.get('live_deployment_id') == deployment_id:
            del running_strategies[run_id]

    try:
        user_row = _get_user_record(user_id)
        if not user_row:
            logging.error("Cannot initialize live strategy monitor: user %s not found", user_id)
            return

        user_data = dict(user_row)
        api_key = user_data.get('app_key')
        if not api_key:
            logging.error("Cannot initialize live strategy monitor: user %s missing Zerodha API key", user_id)
            return

        instrument = strategy_data.get('instrument') or config.get('instrument') or 'BANKNIFTY'
        candle_time_value = strategy_data.get('candle_time') or config.get('candleIntervalMinutes') or 5
        candle_time = str(candle_time_value)
        start_time = strategy_data.get('start_time') or '09:15'
        end_time = strategy_data.get('end_time') or '15:30'

        stop_loss_value = strategy_data.get('stop_loss')
        if stop_loss_value is None:
            stop_loss_value = config.get('stopLossPercent')
        try:
            stop_loss_value = float(stop_loss_value)
        except Exception:
            stop_loss_value = 0.0

        target_profit_value = strategy_data.get('target_profit')
        if target_profit_value is None:
            target_profit_value = config.get('targetPercent')
        try:
            target_profit_value = float(target_profit_value)
        except Exception:
            target_profit_value = 0.0

        total_lot_value: Any = strategy_data.get('total_lot')
        if total_lot_value in (None, 0):
            total_lot_value = config.get('lotCount') or lot_count or 1
        try:
            total_lot = int(total_lot_value)
        except Exception:
            total_lot = int(lot_count or 1)

        trailing_stop_loss_value = strategy_data.get('trailing_stop_loss')
        if trailing_stop_loss_value is None:
            trailing_stop_loss_value = 0
        try:
            trailing_stop_loss = float(trailing_stop_loss_value)
        except Exception:
            trailing_stop_loss = 0.0

        segment = strategy_data.get('segment') or 'OPT'
        trade_type = strategy_data.get('trade_type') or 'INTRADAY'

        strike_price_value = strategy_data.get('strike_price')
        try:
            strike_price = float(strike_price_value) if strike_price_value is not None else 0.0
        except Exception:
            strike_price = 0.0

        expiry_type = strategy_data.get('expiry_type') or 'monthly'
        strategy_name_input = strategy_data.get('strategy_name') or f"Strategy #{strategy_data.get('id') or deployment_id}"

        ema_period_value = strategy_data.get('ema_period')
        if ema_period_value is None:
            ema_period_value = config.get('candleIntervalMinutes') or 5
        try:
            ema_period = int(ema_period_value)
        except Exception:
            ema_period = 5

        def _bootstrap_live_client(client: KiteConnect) -> KiteConnect:
            execute_with_retries(
                f"validating Zerodha session before starting live deployment {deployment_id}",
                lambda: client.profile()
            )
            return client

        token_candidates: List[str] = []
        if access_token:
            token_candidates.append(access_token)

        try:
            live_kite_client = _with_valid_kite_client(
                user_id,
                f"live deployment {deployment_id}",
                _bootstrap_live_client,
                preferred_tokens=token_candidates
            )
        except kite_exceptions.TokenException as exc:
            logging.error("Cannot initialize live strategy monitor for deployment %s: %s", deployment_id, exc)
            return
        except RuntimeError as exc:
            logging.error("Cannot initialize live strategy monitor for deployment %s: %s", deployment_id, exc)
            return

        resolved_token = getattr(live_kite_client, "_access_token", None)
        if not resolved_token and token_candidates:
            resolved_token = token_candidates[0]

        live_order_context = {
            'api_key': api_key,
            'access_token': resolved_token,
            'deployment_id': deployment_id,
            'product': (config.get('product') or 'MIS').upper(),
            'tag': f"AIML-LIVE-{deployment_id}",
            'kite_client': live_kite_client,
        }

        base_lot_size = 25 if 'BANK' in instrument.upper() else 50
        live_order_context['lot_size'] = base_lot_size

        strategy_instance = CaptureMountainSignal(
            kite,
            instrument,
            candle_time,
            start_time,
            end_time,
            stop_loss_value,
            target_profit_value,
            total_lot,
            trailing_stop_loss,
            segment,
            trade_type,
            strike_price,
            expiry_type,
            strategy_name_input,
            paper_trade=False,
            ema_period=ema_period,
            session_id=None,
            live_order_context=live_order_context,
        )
        try:
            strategy_instance.run()
        except Exception:
            pass

        strategy_instance.status['paper_trade_mode'] = False

        unique_run_id = str(uuid.uuid4())
        running_strategies[unique_run_id] = {
            'db_id': strategy_data.get('id'),
            'name': strategy_data.get('strategy_name'),
            'instrument': instrument,
            'status': 'running',
            'strategy_type': strategy_type,
            'strategy': strategy_instance,
            'user_id': user_id,
            'paper_trade': False,
            'live_deployment_id': deployment_id,
            'live_context': live_order_context,
        }
        logging.info("Live strategy monitor registered for deployment %s (strategy %s)", deployment_id, strategy_data.get('strategy_name'))
    except Exception as exc:
        logging.error("Failed to initialize live strategy monitor for deployment %s: %s", deployment_id, exc, exc_info=True)


def compute_drawdown_metrics(trades: List[Dict[str, Any]], initial_capital: float) -> Tuple[float, float, float]:
    if initial_capital <= 0:
        return 0.0, 0.0, 0.0

    equity = initial_capital
    equity_curve = [initial_capital]
    for trade in trades:
        pnl = trade.get('pnl')
        if pnl is None:
            continue
        equity += float(pnl)
        equity_curve.append(equity)

    if len(equity_curve) <= 1:
        return 0.0, 0.0, 0.0

    running_max = equity_curve[0]
    max_drawdown = 0.0
    for value in equity_curve[1:]:
        if value > running_max:
            running_max = value
        drawdown = value - running_max
        if drawdown < max_drawdown:
            max_drawdown = drawdown

    max_drawdown_abs = abs(max_drawdown)
    max_drawdown_percent = (max_drawdown_abs / running_max * 100) if running_max != 0 else 0.0
    roi_percent = ((equity_curve[-1] - initial_capital) / initial_capital * 100) if initial_capital != 0 else 0.0
    return max_drawdown_abs, max_drawdown_percent, roi_percent


def get_option_symbol_from_components(instrument_key: str, strike: int, option_type: str, candle_date: Any) -> str:
    dt_obj = ensure_datetime(candle_date)
    year = dt_obj.year % 100
    month_names = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
    month = month_names[dt_obj.month - 1]
    strike_int = int(strike)
    return f"{instrument_key}{year:02d}{month}{strike_int}{option_type}"


def simulate_option_premium(index_price: float, strike: float, option_type: str) -> float:
    distance = abs(index_price - strike)
    premium = 100.0
    if option_type.upper() == 'PE':
        premium += distance * 0.5 if strike > index_price else -distance * 0.3
    else:
        premium += distance * 0.5 if strike < index_price else -distance * 0.3
    return max(10.0, premium)


# ---------------------------------------------------------------------------
# AI Strategy Assistant Helpers
# ---------------------------------------------------------------------------

AI_STRATEGY_SYSTEM_PROMPT = """You are an expert algorithmic trading strategist. Convert user's trading strategy descriptions into a standardized format.

OUTPUT FORMAT:
STRATEGY "[strategy_name]" VERSION [version]
DESCRIPTION "[strategy_description]"

EVALUATION
  SCHEDULE every [timeframe] candle
  TIMING evaluate [time] before candle close

RULES SECTION (signal identification and management)
ENTRY SECTION (trade entry conditions and execution)
EXIT SECTION (exit conditions with priorities)

CRITICAL REQUIREMENTS:
1. Always use the exact format above
2. Use consistent indentation with 2 spaces
3. Include proper risk management (stop loss, target)
4. Use clear, algorithmic conditions
5. Include logging for all important events
6. Specify instrument details (BANKNIFTY/NIFTY, lot sizes, strike rounding)
7. Use timeframe: 5m/15m/1h based on user preference
8. Include re-entry rules and position management

Provide only the formatted strategy without additional commentary."""

AI_STRATEGY_OUTPUT_DIR = Path(__file__).resolve().parent / "generated_strategies"


def _slugify(value: str) -> str:
    value = value.strip().lower()
    value = re.sub(r'[^a-z0-9]+', '-', value)
    value = re.sub(r'-{2,}', '-', value)
    return value.strip('-') or 'strategy'


def _get_groq_client() -> Groq:
    if Groq is None:
        raise RuntimeError("Groq SDK is not installed. Please install the 'groq' package.")

    api_key = os.environ.get('GROQ_API_KEY') or getattr(config, 'GROQ_API_KEY', None)
    if not api_key:
        raise RuntimeError("GROQ_API_KEY is not configured. Set it in the environment or config.")

    return Groq(api_key=api_key)


def clean_strategy_output(strategy_text: str) -> str:
    strategy_text = re.sub(r'```(?:strategy)?\s*', '', strategy_text)
    strategy_text = re.sub(r'```\s*', '', strategy_text)
    lines = strategy_text.splitlines()
    cleaned_lines = [line.rstrip() for line in lines if line.strip()]
    return '\n'.join(cleaned_lines).strip()


def validate_strategy_format(strategy_text: str) -> Dict[str, Any]:
    required_sections = [
        "STRATEGY",
        "DESCRIPTION",
        "EVALUATION",
        "RULE",
        "ENTRY",
        "EXIT",
    ]
    validation_result = {
        "is_valid": True,
        "missing_sections": [],
        "warnings": [],
    }
    upper_text = strategy_text.upper()
    for section in required_sections:
        if section not in upper_text:
            validation_result["missing_sections"].append(section)
            validation_result["is_valid"] = False

    if "WHEN" not in upper_text and "TRIGGER" not in upper_text:
        validation_result["warnings"].append("No conditions found (WHEN/TRIGGER).")
    return validation_result


def save_strategy_to_file(strategy_text: str, user_id: Optional[int] = None) -> str:
    AI_STRATEGY_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    strategy_text_clean = clean_strategy_output(strategy_text)
    name_match = re.search(r'STRATEGY\s+"([^"]+)"', strategy_text_clean, re.IGNORECASE)
    strategy_name = name_match.group(1) if name_match else 'trading_strategy'
    slug = _slugify(strategy_name)
    timestamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    if user_id:
        filename = f"{slug}_u{user_id}_{timestamp}.strategy"
    else:
        filename = f"{slug}_{timestamp}.strategy"

    file_path = AI_STRATEGY_OUTPUT_DIR / filename
    file_path.write_text(strategy_text_clean, encoding='utf-8')
    return str(file_path.relative_to(Path(__file__).resolve().parent))


def create_trading_strategy_from_chat(
    user_message: str,
    conversation_history: Optional[List[Dict[str, str]]] = None,
    model: Optional[str] = None,
) -> str:
    client = _get_groq_client()
    model_name = model or os.environ.get('GROQ_MODEL', 'llama-3.1-8b-instant')
    messages: List[Dict[str, str]] = [{"role": "system", "content": AI_STRATEGY_SYSTEM_PROMPT}]
    if conversation_history:
        for item in conversation_history[-10:]:
            role = item.get('role')
            content = (item.get('content') or '').strip()
            if role in ('user', 'assistant') and content:
                messages.append({"role": role, "content": content})

    messages.append({"role": "user", "content": user_message})
    response = client.chat.completions.create(
        messages=messages,
        model=model_name,
        temperature=0.3,
        max_tokens=2000,
        top_p=0.9,
    )
    generated = response.choices[0].message.content or ""
    return clean_strategy_output(generated)


def run_mountain_signal_strategy_on_dataframe(
    df: 'pd.DataFrame',
    instrument_key: str,
    lot_size_value: int,
    strike_step: int,
    stop_loss_percent: float,
    target_percent: float,
    rsi_overbought_threshold: float = 70.0,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    trades: List[Dict[str, Any]] = []
    option_trades: List[Dict[str, Any]] = []
    trade_placed = False
    position = 0
    entry_price = 0.0
    pe_signal_candle = None
    ce_signal_candle = None
    signal_candles_with_entry: set = set()
    pe_signal_price_above_low = False
    ce_signal_price_below_high = False
    consecutive_candles_for_target = 0
    last_candle_high_less_than_ema = False
    last_candle_low_greater_than_ema = False
    active_trade_signal_candle = None
    option_trade_sequence = 0
    active_option_trade = None

    for i in range(1, len(df)):
        current_candle = df.iloc[i]
        previous_candle = df.iloc[i - 1]
        current_ema = current_candle['ema']
        previous_ema = previous_candle['ema']
        previous_rsi = df.iloc[i - 1]['rsi14'] if 'rsi14' in df.columns else None

        if previous_candle['low'] > previous_ema:
            if previous_rsi is not None and previous_rsi > rsi_overbought_threshold:
                if pe_signal_candle is not None:
                    pe_signal_price_above_low = False
                    if 'index' in pe_signal_candle:
                        signal_candles_with_entry.discard(pe_signal_candle['index'])
                pe_signal_candle = {
                    'date': previous_candle['date'],
                    'high': previous_candle['high'],
                    'low': previous_candle['low'],
                    'index': i - 1
                }
                ce_signal_candle = None

        if previous_candle['high'] < previous_ema:
            if previous_rsi is not None and previous_rsi < 30:
                if ce_signal_candle is not None:
                    ce_signal_price_below_high = False
                    if 'index' in ce_signal_candle:
                        signal_candles_with_entry.discard(ce_signal_candle['index'])
                ce_signal_candle = {
                    'date': previous_candle['date'],
                    'high': previous_candle['high'],
                    'low': previous_candle['low'],
                    'index': i - 1
                }
                pe_signal_candle = None

        if pe_signal_candle is not None and not trade_placed and not pe_signal_price_above_low:
            if current_candle['high'] > pe_signal_candle['low']:
                pe_signal_price_above_low = True

        if ce_signal_candle is not None and not trade_placed and not ce_signal_price_below_high:
            if current_candle['low'] < ce_signal_candle['high']:
                ce_signal_price_below_high = True

        if not trade_placed:
            if pe_signal_candle is not None and current_candle['close'] < pe_signal_candle['low']:
                signal_candle_index = pe_signal_candle['index']
                is_first_entry = signal_candle_index not in signal_candles_with_entry
                entry_allowed = is_first_entry or pe_signal_price_above_low

                if entry_allowed:
                    trade_placed = True
                    position = -1
                    entry_price = current_candle['close']
                    signal_candles_with_entry.add(signal_candle_index)
                    pe_signal_price_above_low = False
                    active_trade_signal_candle = {
                        'high': pe_signal_candle['high'],
                        'low': pe_signal_candle['low'],
                        'type': 'PE'
                    }
                    trade_record = {
                        'signal_time': pe_signal_candle['date'],
                        'signal_type': 'PE',
                        'signal_high': pe_signal_candle['high'],
                        'signal_low': pe_signal_candle['low'],
                        'entry_time': current_candle['date'],
                        'entry_price': entry_price,
                        'exit_time': None,
                        'exit_price': None,
                        'exit_type': None,
                        'pnl': None,
                        'pnl_percent': None,
                        'date': current_candle['date'].date() if isinstance(current_candle['date'], datetime.datetime) else current_candle['date'],
                        'lot_size': lot_size_value,
                        'option_trade_id': None,
                        'option_symbol': None,
                        'option_entry_price': None,
                        'stop_loss_price': None,
                        'target_price': None,
                        'option_exit_price': None
                    }
                    trades.append(trade_record)
                    consecutive_candles_for_target = 0
                    last_candle_high_less_than_ema = False

                    trade_index = len(trades) - 1
                    trade_date_value = trades[trade_index]['date']
                    atm_strike = round_to_atm_price(entry_price, strike_step)
                    option_symbol = get_option_symbol_from_components(instrument_key, atm_strike, 'PE', current_candle['date'])
                    option_entry_price = simulate_option_premium(entry_price, atm_strike, 'PE')
                    stop_loss_price_abs = round(option_entry_price * (1 + stop_loss_percent), 2)
                    target_price_abs = round(option_entry_price * (1 + target_percent), 2)

                    option_trade = {
                        'id': option_trade_sequence,
                        'index_trade_index': trade_index,
                        'signal_time': pe_signal_candle['date'],
                        'signal_type': 'PE',
                        'signal_high': float(pe_signal_candle['high']),
                        'signal_low': float(pe_signal_candle['low']),
                        'entry_time': current_candle['date'],
                        'index_at_entry': float(entry_price),
                        'atm_strike': float(atm_strike),
                        'option_symbol': option_symbol,
                        'option_entry_price': float(option_entry_price),
                        'stop_loss_price': float(stop_loss_price_abs),
                        'target_price': float(target_price_abs),
                        'option_exit_price': None,
                        'exit_time': None,
                        'exit_type': None,
                        'pnl': None,
                        'pnl_percent': None,
                        'status': 'open',
                        'lot_size': lot_size_value,
                        'date': trade_date_value
                    }
                    option_trades.append(option_trade)
                    option_trade_sequence += 1
                    trades[trade_index]['option_trade_id'] = option_trade['id']
                    trades[trade_index]['option_symbol'] = option_symbol
                    trades[trade_index]['option_entry_price'] = float(option_entry_price)
                    trades[trade_index]['stop_loss_price'] = float(stop_loss_price_abs)
                    trades[trade_index]['target_price'] = float(target_price_abs)
                    active_option_trade = option_trade

            elif ce_signal_candle is not None and current_candle['close'] > ce_signal_candle['high']:
                signal_candle_index = ce_signal_candle['index']
                is_first_entry = signal_candle_index not in signal_candles_with_entry
                entry_allowed = is_first_entry or ce_signal_price_below_high

                if entry_allowed:
                    trade_placed = True
                    position = 1
                    entry_price = current_candle['close']
                    signal_candles_with_entry.add(signal_candle_index)
                    ce_signal_price_below_high = False
                    active_trade_signal_candle = {
                        'high': ce_signal_candle['high'],
                        'low': ce_signal_candle['low'],
                        'type': 'CE'
                    }
                    trade_record = {
                        'signal_time': ce_signal_candle['date'],
                        'signal_type': 'CE',
                        'signal_high': ce_signal_candle['high'],
                        'signal_low': ce_signal_candle['low'],
                        'entry_time': current_candle['date'],
                        'entry_price': entry_price,
                        'exit_time': None,
                        'exit_price': None,
                        'exit_type': None,
                        'pnl': None,
                        'pnl_percent': None,
                        'date': current_candle['date'].date() if isinstance(current_candle['date'], datetime.datetime) else current_candle['date'],
                        'lot_size': lot_size_value,
                        'option_trade_id': None,
                        'option_symbol': None,
                        'option_entry_price': None,
                        'stop_loss_price': None,
                        'target_price': None,
                        'option_exit_price': None
                    }
                    trades.append(trade_record)
                    consecutive_candles_for_target = 0
                    last_candle_low_greater_than_ema = False

                    trade_index = len(trades) - 1
                    trade_date_value = trades[trade_index]['date']
                    atm_strike = round_to_atm_price(entry_price, strike_step)
                    option_symbol = get_option_symbol_from_components(instrument_key, atm_strike, 'CE', current_candle['date'])
                    option_entry_price = simulate_option_premium(entry_price, atm_strike, 'CE')
                    stop_loss_price_abs = round(option_entry_price * (1 + stop_loss_percent), 2)
                    target_price_abs = round(option_entry_price * (1 + target_percent), 2)

                    option_trade = {
                        'id': option_trade_sequence,
                        'index_trade_index': trade_index,
                        'signal_time': ce_signal_candle['date'],
                        'signal_type': 'CE',
                        'signal_high': float(ce_signal_candle['high']),
                        'signal_low': float(ce_signal_candle['low']),
                        'entry_time': current_candle['date'],
                        'index_at_entry': float(entry_price),
                        'atm_strike': float(atm_strike),
                        'option_symbol': option_symbol,
                        'option_entry_price': float(option_entry_price),
                        'stop_loss_price': float(stop_loss_price_abs),
                        'target_price': float(target_price_abs),
                        'option_exit_price': None,
                        'exit_time': None,
                        'exit_type': None,
                        'pnl': None,
                        'pnl_percent': None,
                        'status': 'open',
                        'lot_size': lot_size_value,
                        'date': trade_date_value
                    }
                    option_trades.append(option_trade)
                    option_trade_sequence += 1
                    trades[trade_index]['option_trade_id'] = option_trade['id']
                    trades[trade_index]['option_symbol'] = option_symbol
                    trades[trade_index]['option_entry_price'] = float(option_entry_price)
                    trades[trade_index]['stop_loss_price'] = float(stop_loss_price_abs)
                    trades[trade_index]['target_price'] = float(target_price_abs)
                    active_option_trade = option_trade

        elif trade_placed:
            candle_time_obj = current_candle['date']
            if isinstance(candle_time_obj, datetime.datetime):
                candle_time_check = candle_time_obj.time()
            else:
                candle_time_check = datetime.datetime.now().time()

            current_trade_index = len(trades) - 1
            current_trade = trades[current_trade_index] if current_trade_index >= 0 else None

            linked_option_trade = None
            option_exit_price = None
            option_exit_type = None
            if active_option_trade and current_trade and current_trade.get('option_trade_id') == active_option_trade.get('id'):
                linked_option_trade = active_option_trade
                option_exit_price = simulate_option_premium(
                    current_candle['close'],
                    linked_option_trade['atm_strike'],
                    linked_option_trade['signal_type']
                )
                if option_exit_price <= linked_option_trade['stop_loss_price']:
                    option_exit_type = 'OPTION_STOP_LOSS'
                elif option_exit_price >= linked_option_trade['target_price']:
                    option_exit_type = 'OPTION_TARGET'

            if option_exit_type and current_trade:
                lot_size_for_trade = current_trade.get('lot_size', lot_size_value)
                entry_price_value = current_trade['entry_price']
                exit_price_value = current_candle['close']
                if position == -1:
                    pnl_val = (entry_price_value - exit_price_value) * lot_size_for_trade
                    pnl_percent_val = ((entry_price_value - exit_price_value) / entry_price_value) * 100 if entry_price_value else 0
                else:
                    pnl_val = (exit_price_value - entry_price_value) * lot_size_for_trade
                    pnl_percent_val = ((exit_price_value - entry_price_value) / entry_price_value) * 100 if entry_price_value else 0

                current_trade['exit_time'] = current_candle['date']
                current_trade['exit_price'] = exit_price_value
                current_trade['exit_type'] = option_exit_type
                current_trade['pnl'] = pnl_val
                current_trade['pnl_percent'] = pnl_percent_val
                current_trade['option_exit_price'] = option_exit_price

                if linked_option_trade:
                    entry_opt_price = linked_option_trade.get('option_entry_price')
                    lot_size_opt = linked_option_trade.get('lot_size', lot_size_for_trade)
                    linked_option_trade['option_exit_price'] = option_exit_price
                    linked_option_trade['exit_time'] = current_candle['date']
                    linked_option_trade['exit_type'] = option_exit_type
                    if entry_opt_price:
                        linked_option_trade['pnl'] = (option_exit_price - entry_opt_price) * lot_size_opt
                        linked_option_trade['pnl_percent'] = ((option_exit_price - entry_opt_price) / entry_opt_price) * 100 if entry_opt_price else None
                    linked_option_trade['status'] = 'closed'
                    active_option_trade = None

                trade_placed = False
                position = 0
                active_trade_signal_candle = None
                consecutive_candles_for_target = 0
                if current_trade['signal_type'] == 'PE':
                    pe_signal_price_above_low = False
                    last_candle_high_less_than_ema = False
                else:
                    ce_signal_price_below_high = False
                    last_candle_low_greater_than_ema = False
                continue

            if current_trade:
                market_close_square_off_time = datetime.time(15, 15)
                if market_close_square_off_time <= candle_time_check < datetime.time(15, 30):
                    lot_size_for_trade = current_trade.get('lot_size', lot_size_value)
                    entry_price_value = current_trade['entry_price']
                    exit_price_value = current_candle['close']
                    if position == -1:
                        pnl_val = (entry_price_value - exit_price_value) * lot_size_for_trade
                        pnl_percent_val = ((entry_price_value - exit_price_value) / entry_price_value) * 100 if entry_price_value else 0
                    else:
                        pnl_val = (exit_price_value - entry_price_value) * lot_size_for_trade
                        pnl_percent_val = ((exit_price_value - entry_price_value) / entry_price_value) * 100 if entry_price_value else 0

                    option_exit_price_mc = None
                    if linked_option_trade:
                        option_exit_price_mc = simulate_option_premium(
                            current_candle['close'],
                            linked_option_trade['atm_strike'],
                            linked_option_trade['signal_type']
                        )
                        entry_opt_price = linked_option_trade.get('option_entry_price')
                        lot_size_opt = linked_option_trade.get('lot_size', lot_size_for_trade)
                        linked_option_trade['option_exit_price'] = option_exit_price_mc
                        linked_option_trade['exit_time'] = current_candle['date']
                        linked_option_trade['exit_type'] = 'MARKET_CLOSE'
                        if entry_opt_price:
                            linked_option_trade['pnl'] = (option_exit_price_mc - entry_opt_price) * lot_size_opt
                            linked_option_trade['pnl_percent'] = ((option_exit_price_mc - entry_opt_price) / entry_opt_price) * 100 if entry_opt_price else None
                        linked_option_trade['status'] = 'closed'
                        active_option_trade = None

                    current_trade['exit_time'] = current_candle['date']
                    current_trade['exit_price'] = exit_price_value
                    current_trade['exit_type'] = 'MKT_CLOSE'
                    current_trade['pnl'] = pnl_val
                    current_trade['pnl_percent'] = pnl_percent_val
                    current_trade['option_exit_price'] = option_exit_price_mc

                    trade_placed = False
                    position = 0
                    active_trade_signal_candle = None
                    consecutive_candles_for_target = 0
                    if current_trade['signal_type'] == 'PE':
                        pe_signal_price_above_low = False
                        last_candle_high_less_than_ema = False
                    else:
                        ce_signal_price_below_high = False
                        last_candle_low_greater_than_ema = False
                    continue

            if position == -1 and active_trade_signal_candle is not None and active_trade_signal_candle['type'] == 'PE':
                lot_size_for_trade = current_trade.get('lot_size', lot_size_value) if current_trade else lot_size_value
                entry_price_value = current_trade['entry_price'] if current_trade else 0

                if current_candle['close'] > active_trade_signal_candle['high']:
                    exit_price_value = current_candle['close']
                    pnl_val = (entry_price_value - exit_price_value) * lot_size_for_trade
                    pnl_percent_val = ((entry_price_value - exit_price_value) / entry_price_value) * 100 if entry_price_value else 0
                    option_exit_price_idx = None
                    if linked_option_trade:
                        option_exit_price_idx = simulate_option_premium(
                            current_candle['close'],
                            linked_option_trade['atm_strike'],
                            linked_option_trade['signal_type']
                        )
                        entry_opt_price = linked_option_trade.get('option_entry_price')
                        lot_size_opt = linked_option_trade.get('lot_size', lot_size_for_trade)
                        linked_option_trade['option_exit_price'] = option_exit_price_idx
                        linked_option_trade['exit_time'] = current_candle['date']
                        linked_option_trade['exit_type'] = 'INDEX_STOP'
                        if entry_opt_price:
                            linked_option_trade['pnl'] = (option_exit_price_idx - entry_opt_price) * lot_size_opt
                            linked_option_trade['pnl_percent'] = ((option_exit_price_idx - entry_opt_price) / entry_opt_price) * 100 if entry_opt_price else None
                        linked_option_trade['status'] = 'closed'
                        active_option_trade = None

                    current_trade['exit_time'] = current_candle['date']
                    current_trade['exit_price'] = exit_price_value
                    current_trade['exit_type'] = 'INDEX_STOP'
                    current_trade['pnl'] = pnl_val
                    current_trade['pnl_percent'] = pnl_percent_val
                    current_trade['option_exit_price'] = option_exit_price_idx
                    trade_placed = False
                    position = 0
                    active_trade_signal_candle = None
                    pe_signal_price_above_low = False
                    consecutive_candles_for_target = 0
                    last_candle_high_less_than_ema = False
                elif current_candle['high'] < current_ema:
                    last_candle_high_less_than_ema = True
                    consecutive_candles_for_target = 0
                elif last_candle_high_less_than_ema and current_candle['close'] > current_ema:
                    consecutive_candles_for_target += 1
                    if consecutive_candles_for_target >= 2:
                        exit_price_value = current_candle['close']
                        pnl_val = (entry_price_value - exit_price_value) * lot_size_for_trade
                        pnl_percent_val = ((entry_price_value - exit_price_value) / entry_price_value) * 100 if entry_price_value else 0
                        option_exit_price_idx = None
                        if linked_option_trade:
                            option_exit_price_idx = simulate_option_premium(
                                current_candle['close'],
                                linked_option_trade['atm_strike'],
                                linked_option_trade['signal_type']
                            )
                            entry_opt_price = linked_option_trade.get('option_entry_price')
                            lot_size_opt = linked_option_trade.get('lot_size', lot_size_for_trade)
                            linked_option_trade['option_exit_price'] = option_exit_price_idx
                            linked_option_trade['exit_time'] = current_candle['date']
                            linked_option_trade['exit_type'] = 'INDEX_TARGET'
                            if entry_opt_price:
                                linked_option_trade['pnl'] = (option_exit_price_idx - entry_opt_price) * lot_size_opt
                                linked_option_trade['pnl_percent'] = ((option_exit_price_idx - entry_opt_price) / entry_opt_price) * 100 if entry_opt_price else None
                            linked_option_trade['status'] = 'closed'
                            active_option_trade = None

                        current_trade['exit_time'] = current_candle['date']
                        current_trade['exit_price'] = exit_price_value
                        current_trade['exit_type'] = 'INDEX_TARGET'
                        current_trade['pnl'] = pnl_val
                        current_trade['pnl_percent'] = pnl_percent_val
                        current_trade['option_exit_price'] = option_exit_price_idx
                        trade_placed = False
                        position = 0
                        active_trade_signal_candle = None
                        pe_signal_price_above_low = False
                        consecutive_candles_for_target = 0
                        last_candle_high_less_than_ema = False

            elif position == 1 and active_trade_signal_candle is not None and active_trade_signal_candle['type'] == 'CE':
                lot_size_for_trade = current_trade.get('lot_size', lot_size_value) if current_trade else lot_size_value
                entry_price_value = current_trade['entry_price'] if current_trade else 0

                if current_candle['close'] < active_trade_signal_candle['low']:
                    exit_price_value = current_candle['close']
                    pnl_val = (exit_price_value - entry_price_value) * lot_size_for_trade
                    pnl_percent_val = ((exit_price_value - entry_price_value) / entry_price_value) * 100 if entry_price_value else 0
                    option_exit_price_idx = None
                    if linked_option_trade:
                        option_exit_price_idx = simulate_option_premium(
                            current_candle['close'],
                            linked_option_trade['atm_strike'],
                            linked_option_trade['signal_type']
                        )
                        entry_opt_price = linked_option_trade.get('option_entry_price')
                        lot_size_opt = linked_option_trade.get('lot_size', lot_size_for_trade)
                        linked_option_trade['option_exit_price'] = option_exit_price_idx
                        linked_option_trade['exit_time'] = current_candle['date']
                        linked_option_trade['exit_type'] = 'INDEX_STOP'
                        if entry_opt_price:
                            linked_option_trade['pnl'] = (option_exit_price_idx - entry_opt_price) * lot_size_opt
                            linked_option_trade['pnl_percent'] = ((option_exit_price_idx - entry_opt_price) / entry_opt_price) * 100 if entry_opt_price else None
                        linked_option_trade['status'] = 'closed'
                        active_option_trade = None

                    current_trade['exit_time'] = current_candle['date']
                    current_trade['exit_price'] = exit_price_value
                    current_trade['exit_type'] = 'INDEX_STOP'
                    current_trade['pnl'] = pnl_val
                    current_trade['pnl_percent'] = pnl_percent_val
                    current_trade['option_exit_price'] = option_exit_price_idx
                    trade_placed = False
                    position = 0
                    active_trade_signal_candle = None
                    ce_signal_price_below_high = False
                    consecutive_candles_for_target = 0
                    last_candle_low_greater_than_ema = False
                elif current_candle['low'] > current_ema:
                    last_candle_low_greater_than_ema = True
                    consecutive_candles_for_target = 0
                elif last_candle_low_greater_than_ema and current_candle['close'] < current_ema:
                    consecutive_candles_for_target += 1
                    if consecutive_candles_for_target >= 2:
                        exit_price_value = current_candle['close']
                        pnl_val = (exit_price_value - entry_price_value) * lot_size_for_trade
                        pnl_percent_val = ((exit_price_value - entry_price_value) / entry_price_value) * 100 if entry_price_value else 0
                        option_exit_price_idx = None
                        if linked_option_trade:
                            option_exit_price_idx = simulate_option_premium(
                                current_candle['close'],
                                linked_option_trade['atm_strike'],
                                linked_option_trade['signal_type']
                            )
                            entry_opt_price = linked_option_trade.get('option_entry_price')
                            lot_size_opt = linked_option_trade.get('lot_size', lot_size_for_trade)
                            linked_option_trade['option_exit_price'] = option_exit_price_idx
                            linked_option_trade['exit_time'] = current_candle['date']
                            linked_option_trade['exit_type'] = 'INDEX_TARGET'
                            if entry_opt_price:
                                linked_option_trade['pnl'] = (option_exit_price_idx - entry_opt_price) * lot_size_opt
                                linked_option_trade['pnl_percent'] = ((option_exit_price_idx - entry_opt_price) / entry_opt_price) * 100 if entry_opt_price else None
                            linked_option_trade['status'] = 'closed'
                            active_option_trade = None

                        current_trade['exit_time'] = current_candle['date']
                        current_trade['exit_price'] = exit_price_value
                        current_trade['exit_type'] = 'INDEX_TARGET'
                        current_trade['pnl'] = pnl_val
                        current_trade['pnl_percent'] = pnl_percent_val
                        current_trade['option_exit_price'] = option_exit_price_idx
                        trade_placed = False
                        position = 0
                        active_trade_signal_candle = None
                        ce_signal_price_below_high = False
                        consecutive_candles_for_target = 0
                        last_candle_low_greater_than_ema = False

    if trade_placed and trades:
        last_trade = trades[-1]
        last_candle = df.iloc[-1]
        exit_price_value = last_candle['close']
        lot_size_for_trade = last_trade.get('lot_size', lot_size_value)
        entry_price_value = last_trade['entry_price']
        if position == -1:
            pnl_val = (entry_price_value - exit_price_value) * lot_size_for_trade
            pnl_percent_val = ((entry_price_value - exit_price_value) / entry_price_value) * 100 if entry_price_value else 0
        else:
            pnl_val = (exit_price_value - entry_price_value) * lot_size_for_trade
            pnl_percent_val = ((exit_price_value - entry_price_value) / entry_price_value) * 100 if entry_price_value else 0

        option_exit_price_forced = None
        if active_option_trade and last_trade.get('option_trade_id') == active_option_trade.get('id'):
            option_exit_price_forced = simulate_option_premium(
                exit_price_value,
                active_option_trade['atm_strike'],
                active_option_trade['signal_type']
            )
            entry_opt_price = active_option_trade.get('option_entry_price')
            lot_size_opt = active_option_trade.get('lot_size', lot_size_for_trade)
            active_option_trade['option_exit_price'] = option_exit_price_forced
            active_option_trade['exit_time'] = last_candle['date']
            active_option_trade['exit_type'] = 'FORCED_CLOSE'
            if entry_opt_price:
                active_option_trade['pnl'] = (option_exit_price_forced - entry_opt_price) * lot_size_opt
                active_option_trade['pnl_percent'] = ((option_exit_price_forced - entry_opt_price) / entry_opt_price) * 100 if entry_opt_price else None
            active_option_trade['status'] = 'closed'
            active_option_trade = None

        last_trade['exit_time'] = last_candle['date']
        last_trade['exit_price'] = exit_price_value
        last_trade['exit_type'] = 'FORCED_CLOSE'
        last_trade['pnl'] = pnl_val
        last_trade['pnl_percent'] = pnl_percent_val
        last_trade['option_exit_price'] = option_exit_price_forced

    if active_option_trade and active_option_trade.get('status') != 'closed':
        active_option_trade['status'] = 'open'

    return trades, option_trades


def aggregate_trades_by_period(trades: List[Dict[str, Any]], period: str) -> List[Dict[str, Any]]:
    if not trades:
        return []

    import pandas as pd  # Local import to avoid global dependency if not used elsewhere

    rows: List[Dict[str, Any]] = []
    for trade in trades:
        pnl = trade.get('pnl')
        if pnl is None:
            continue
        trade_date_value = trade.get('date') or trade.get('entry_time') or trade.get('signal_time')
        dt_obj = ensure_datetime(trade_date_value)
        rows.append({
            'date': dt_obj,
            'pnl': float(pnl),
            'signal_type': trade.get('signal_type', ''),
        })

    if not rows:
        return []

    df = pd.DataFrame(rows)

    if period == 'daily':
        df['label'] = df['date'].dt.date.astype(str)
    elif period == 'weekly':
        df['label'] = df['date'].dt.strftime('%G-W%V')
    elif period == 'monthly':
        df['label'] = df['date'].dt.strftime('%Y-%m')
    elif period == 'yearly':
        df['label'] = df['date'].dt.strftime('%Y')
    else:
        raise ValueError(f"Unsupported aggregation period: {period}")

    results: List[Dict[str, Any]] = []
    grouped = df.groupby('label')
    for label, group in grouped:
        trades_count = len(group)
        wins = int((group['pnl'] > 0).sum())
        losses = trades_count - wins
        total_pnl = group['pnl'].sum()
        avg_pnl = total_pnl / trades_count if trades_count > 0 else 0
        win_rate = (wins / trades_count * 100) if trades_count > 0 else 0

        results.append({
            'label': label,
            'trades': trades_count,
            'wins': wins,
            'losses': losses,
            'winRate': round(win_rate, 2),
            'pnl': round(total_pnl, 2),
            'avgPnl': round(avg_pnl, 2),
        })

    results.sort(key=lambda item: item['label'])
    return results


# Configure logging
logging.basicConfig(level=logging.INFO)
# Reduce noisy werkzeug/socket logs (but keep ERROR level for debugging)
try:
    logging.getLogger('werkzeug').setLevel(logging.WARNING)  # Changed from ERROR to WARNING to see 404s
    logging.getLogger('engineio').setLevel(logging.ERROR)  # Only show errors, suppress INFO messages
    logging.getLogger('socketio').setLevel(logging.ERROR)  # Only show errors, suppress INFO messages
except Exception:
    pass

app = Flask(__name__)
app.secret_key = config.SECRET_KEY

# Configure CORS
CORS(app, 
     origins=config.CORS_ORIGINS,
     supports_credentials=True,
     allow_headers=['Content-Type', 'Authorization'],
     methods=['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'])

# Configure SocketIO with CORS - allow both frontend and backend origins for development
# Also include production domain if not already in CORS_ORIGINS
# Build CORS origins list - include backend origin for development
# In production, CORS_ORIGINS should include production domain
socketio_cors_origins = list(config.CORS_ORIGINS)
# Add localhost origins for development (safe to include even in production)
if 'http://localhost:8000' not in socketio_cors_origins:
    socketio_cors_origins.append('http://localhost:8000')
if 'http://127.0.0.1:8000' not in socketio_cors_origins:
    socketio_cors_origins.append('http://127.0.0.1:8000')
# Add production domain if FRONTEND_URL is set and not localhost
if config.FRONTEND_URL and 'localhost' not in config.FRONTEND_URL:
    production_origin = config.FRONTEND_URL.rstrip('/')
    if production_origin not in socketio_cors_origins:
        socketio_cors_origins.append(production_origin)
        logging.info(f"SocketIO: Added production origin to CORS: {production_origin}")

# Use the async mode determined at the top of the file (before imports)
if ASYNC_MODE == 'eventlet':
    logging.info("SocketIO: Using eventlet async mode")
elif ASYNC_MODE == 'gevent':
    logging.info("SocketIO: Using gevent async mode")
else:
    logging.warning("SocketIO: Using threading mode (eventlet/gevent not available - install for better performance)")

socketio = SocketIO(app, 
                    cors_allowed_origins=socketio_cors_origins,
                    async_mode=ASYNC_MODE,
                    logger=False,  # Disable verbose Socket.IO logging
                    engineio_logger=False,  # Disable verbose EngineIO logging
                    ping_timeout=60,
                    ping_interval=25,
                    allow_upgrades=True,
                    transports=['polling', 'websocket'],
                    always_connect=True,
                    cookie=None)  # Disable cookie to avoid session issues
                    # Note: path defaults to '/socket.io/' - don't override unless needed

# Ensure live trade tables exist on startup
ensure_live_trade_tables()

# Run admin migration on startup
try:
    from migrate_admin import migrate_admin_field
    migrate_admin_field()
except Exception as e:
    logging.warning(f"Admin migration failed (may already be done): {e}")

# Run strategy approval migration on startup
try:
    from migrate_strategy_approval import migrate_strategy_approval
    migrate_strategy_approval()
except Exception as e:
    logging.warning(f"Strategy approval migration failed (may already be done): {e}")

# Helper utilities for live trade feature

def _get_frontend_url(default: str = 'http://localhost:3000') -> str:
    """
    Get frontend URL that works in both local and production environments.
    
    Priority:
    1. config.FRONTEND_URL (if set and not localhost default)
    2. Request Origin header (if available and not localhost)
    3. Request Referer header (if available and not localhost)
    4. Default fallback (usually localhost:3000)
    
    Args:
        default: Default URL to use if none can be determined
        
    Returns:
        Frontend URL string
    """
    # Check config first
    frontend_url = config.FRONTEND_URL
    if frontend_url and frontend_url != 'http://localhost:3000':
        return frontend_url
    
    # Try to infer from request headers (only if in request context)
    if has_request_context():
        origin = request.headers.get('Origin', '')
        if origin and 'localhost' not in origin and '127.0.0.1' not in origin:
            return origin
        
        referer = request.headers.get('Referer', '')
        if referer:
            try:
                from urllib.parse import urlparse
                parsed = urlparse(referer)
                if parsed.hostname and 'localhost' not in parsed.hostname and '127.0.0.1' not in parsed.hostname:
                    return f"{parsed.scheme}://{parsed.netloc}"
            except Exception:
                pass
    
    # Fallback to default
    return default

def _get_user_record(user_id: int) -> Optional[sqlite3.Row]:
    conn = get_db_connection()
    try:
        return conn.execute('SELECT * FROM users WHERE id = ?', (user_id,)).fetchone()
    finally:
        conn.close()

def _is_admin(user_id: Optional[int] = None, email: Optional[str] = None) -> bool:
    """
    Check if a user is an admin.
    
    Args:
        user_id: User ID to check (if provided)
        email: User email to check (if provided, takes precedence)
    
    Returns:
        True if user is admin, False otherwise
    """
    if not user_id and not email:
        return False
    
    conn = get_db_connection()
    try:
        if email:
            user = conn.execute('SELECT is_admin FROM users WHERE email = ?', (email,)).fetchone()
        else:
            user = conn.execute('SELECT is_admin FROM users WHERE id = ?', (user_id,)).fetchone()
        
        if user:
            # Handle both boolean and integer (SQLite stores booleans as integers)
            is_admin = user['is_admin']
            return bool(is_admin) if is_admin is not None else False
        return False
    finally:
        conn.close()

def _require_admin():
    """
    Decorator helper to check if current user is admin.
    Raises 403 if not admin.
    """
    if 'user_id' not in session:
        return False
    
    # Get user email from session or database
    user_id = session.get('user_id')
    conn = get_db_connection()
    try:
        user = conn.execute('SELECT email, is_admin FROM users WHERE id = ?', (user_id,)).fetchone()
        if user:
            is_admin = bool(user['is_admin']) if user['is_admin'] is not None else False
            # Also check if email is raj.bapa@gmail.com (backup check)
            if user['email'] == 'raj.bapa@gmail.com':
                is_admin = True
            return is_admin
        return False
    finally:
        conn.close()


def _update_user_access_token(user_id: int, token: Optional[str]) -> None:
    conn = get_db_connection()
    try:
        if token:
            conn.execute(
                'UPDATE users SET zerodha_access_token = ?, zerodha_token_created_at = ? WHERE id = ?',
                (token, datetime.datetime.utcnow().isoformat(), user_id)
            )
        else:
            conn.execute(
                'UPDATE users SET zerodha_access_token = NULL, zerodha_token_created_at = NULL WHERE id = ?',
                (user_id,)
            )
        conn.commit()
    finally:
        conn.close()


def _validate_kite_token(app_key: str, token: str) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    kite_client = KiteConnect(api_key=app_key)
    kite_client.set_access_token(token)
    profile = execute_with_retries(
        "validating Zerodha access token",
        lambda: kite_client.profile()
    )
    margins = execute_with_retries(
        "fetching Zerodha margins during validation",
        lambda: kite_client.margins()
    )
    return profile, margins


def _collect_candidate_tokens(
    user: Dict[str, Any],
    preferred_tokens: Optional[List[str]] = None,
) -> Tuple[List[str], Optional[str], Optional[str]]:
    seen: Set[str] = set()
    candidates: List[str] = []

    def _add(token: Optional[str]) -> None:
        if token and token not in seen:
            candidates.append(token)
            seen.add(token)

    if preferred_tokens:
        for token in preferred_tokens:
            _add(token)

    session_token = None
    if has_request_context():
        try:
            session_token = session.get('access_token')
        except Exception:
            session_token = None
    _add(session_token)

    stored_token = user.get('zerodha_access_token')
    _add(stored_token)

    return candidates, session_token, stored_token


def _with_valid_kite_client(
    user_id: int,
    description: str,
    action: Callable[[KiteConnect], Any],
    preferred_tokens: Optional[List[str]] = None,
) -> Any:
    user_row = _get_user_record(user_id)
    if not user_row:
        raise RuntimeError("User not found")
    user = dict(user_row)
    app_key = user.get('app_key')
    if not app_key:
        raise RuntimeError("Zerodha credentials not configured")

    tokens, session_token, stored_token = _collect_candidate_tokens(user, preferred_tokens)
    if not tokens:
        raise kite_exceptions.TokenException("No Zerodha session available")

    last_error: Optional[Exception] = None
    for token in tokens:
        client = KiteConnect(api_key=app_key)
        try:
            client.set_access_token(token)
            result = action(client)

            if has_request_context():
                try:
                    session['access_token'] = token
                except Exception:
                    pass
            if stored_token != token:
                _update_user_access_token(user_id, token)
                stored_token = token

            kite.api_key = app_key
            kite.set_access_token(token)
            return result
        except kite_exceptions.TokenException as exc:
            logging.warning("%s token invalid for user %s: %s", description, user_id, exc)
            last_error = exc
            if token == session_token:
                if has_request_context():
                    try:
                        session.pop('access_token', None)
                    except Exception:
                        pass
                session_token = None
            if token == stored_token:
                _update_user_access_token(user_id, None)
                stored_token = None
            continue
        except Exception as exc:
            message = str(exc)
            if "Invalid `api_key` or `access_token`" in message or "Incorrect `api_key` or `access_token`" in message:
                logging.warning("%s encountered invalid access token for user %s: %s", description, user_id, exc)
                last_error = kite_exceptions.TokenException(message)
                if token == session_token:
                    if has_request_context():
                        try:
                            session.pop('access_token', None)
                        except Exception:
                            pass
                    session_token = None
                if token == stored_token:
                    _update_user_access_token(user_id, None)
                    stored_token = None
                continue
            raise

    if last_error:
        raise last_error
    raise kite_exceptions.TokenException("No Zerodha session available")


def _wait_for_order_completion(
    kite_client: KiteConnect,
    order_id: str,
    timeout: int = 30,
    poll_interval: float = 1.0,
) -> str:
    deadline = time.time() + timeout
    last_status = 'UNKNOWN'
    while time.time() < deadline:
        try:
            history = kite_client.order_history(order_id)
            if history:
                latest = history[-1]
                last_status = latest.get('status') or last_status
                if last_status in ('COMPLETE', 'REJECTED', 'CANCELLED'):
                    return last_status
        except Exception as exc:
            logging.debug("Order status poll failed for %s: %s", order_id, exc)
        time.sleep(poll_interval)
    return last_status


def _get_strategy_record(strategy_id: int, user_id: int) -> Optional[sqlite3.Row]:
    conn = get_db_connection()
    try:
        return conn.execute(
            'SELECT * FROM strategies WHERE id = ? AND user_id = ?',
            (strategy_id, user_id)
        ).fetchone()
    finally:
        conn.close()

def _get_strategy_record_for_preview(strategy_id: int, user_id: int) -> Optional[sqlite3.Row]:
    """
    For trade preview we allow:
      - Strategies owned by the user (any visibility/status)
      - Public strategies (shared by others)
    Deployment and order placement must still use _get_strategy_record (owned by user).
    """
    conn = get_db_connection()
    try:
        return conn.execute(
            "SELECT * FROM strategies WHERE id = ? AND (user_id = ? OR visibility = 'public')",
            (strategy_id, user_id)
        ).fetchone()
    finally:
        conn.close()

def _get_strategy_record_for_deploy(strategy_id: int, user_id: int) -> Optional[sqlite3.Row]:
    """
    For live deploy we allow:
      - Strategies owned by the user (any approval), but backend deploy flow elsewhere enforces 'approved'
      - Public strategies that are approved (shared by others)
    """
    conn = get_db_connection()
    try:
        return conn.execute(
            """
            SELECT * FROM strategies 
            WHERE id = ?
              AND (
                    user_id = ?
                 OR (visibility = 'public' AND (approval_status = 'approved' OR approval_status IS NULL))
              )
            """,
            (strategy_id, user_id)
        ).fetchone()
    finally:
        conn.close()

def _serialize_live_deployment(deployment: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not deployment:
        return None

    def _safe_iso(value: Any) -> Optional[str]:
        if not value:
            return None
        if isinstance(value, str):
            return value
        if isinstance(value, (datetime.datetime, datetime.date)):
            return value.isoformat()
        return str(value)

    state = deployment.get('state') or {}
    return {
        'id': deployment.get('id'),
        'userId': deployment.get('user_id'),
        'strategyId': deployment.get('strategy_id'),
        'strategyName': deployment.get('strategy_name'),
        'status': deployment.get('status'),
        'initialInvestment': deployment.get('initial_investment'),
        'scheduledStart': _safe_iso(deployment.get('scheduled_start')),
        'startedAt': _safe_iso(deployment.get('started_at')),
        'lastRunAt': _safe_iso(deployment.get('last_run_at')),
        'errorMessage': deployment.get('error_message'),
        'state': state,
        'createdAt': _safe_iso(deployment.get('created_at')),
        'updatedAt': _safe_iso(deployment.get('updated_at')),
    }


def _sanitize_orders(raw_orders: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    fields = [
        'order_id', 'status', 'tradingsymbol', 'transaction_type', 'quantity',
        'filled_quantity', 'pending_quantity', 'price', 'trigger_price',
        'average_price', 'exchange', 'product', 'order_type', 'variety',
        'order_timestamp', 'exchange_timestamp'
    ]
    sanitized: List[Dict[str, Any]] = []
    for order in raw_orders:
        entry = {key: order.get(key) for key in fields if key in order}
        sanitized.append(entry)
    return sanitized


def _sanitize_positions(raw_positions: Dict[str, Any]) -> List[Dict[str, Any]]:
    positions: List[Dict[str, Any]] = []
    if not raw_positions:
        return positions
    for pos in raw_positions.get('net', []):
        positions.append({
            'tradingsymbol': pos.get('tradingsymbol'),
            'instrument_token': pos.get('instrument_token'),
            'exchange': pos.get('exchange'),
            'product': pos.get('product'),
            'quantity': pos.get('quantity'),
            'buy_quantity': pos.get('buy_quantity'),
            'sell_quantity': pos.get('sell_quantity'),
            'gross_quantity': pos.get('quantity'),
            'buy_price': pos.get('buy_price'),
            'sell_price': pos.get('sell_price'),
            'last_price': pos.get('last_price'),
            'pnl': pos.get('pnl'),
            'm2m': pos.get('m2m'),
        })
    return positions


def _last_thursday(year: int, month: int) -> datetime.date:
    last_day = calendar.monthrange(year, month)[1]
    date_obj = datetime.date(year, month, last_day)
    while date_obj.weekday() != 3:  # Thursday
        date_obj -= datetime.timedelta(days=1)
    return date_obj


def get_next_monthly_expiry(reference_date: Optional[datetime.date] = None) -> datetime.date:
    if reference_date is None:
        reference_date = datetime.date.today()
    year = reference_date.year
    month = reference_date.month
    expiry = _last_thursday(year, month)
    if reference_date > expiry:
        if month == 12:
            year += 1
            month = 1
        else:
            month += 1
        expiry = _last_thursday(year, month)
    return expiry


def get_spot_quote(kite_client: KiteConnect, instrument_key: str) -> float:
    if instrument_key.upper().startswith('BANK'):
        quote_token = BANKNIFTY_SPOT_SYMBOL
    else:
        quote_token = NIFTY_SPOT_SYMBOL
    quote = execute_with_retries(
        f"fetching spot quote for {quote_token}",
        lambda: kite_client.quote([quote_token])
    )
    data = quote.get(quote_token)
    if not data:
        raise RuntimeError(f"Unable to fetch spot quote for {quote_token}")
    last_price = data.get('last_price')
    if last_price is None:
        raise RuntimeError(f"Spot quote missing last price for {quote_token}")
    return float(last_price)


def get_strategy_rule_config(strategy_row: Optional[sqlite3.Row]) -> Dict[str, Any]:
    if not strategy_row:
        return {}
    name = (strategy_row['strategy_name'] or '').lower()
    strategy_type = (strategy_row['strategy_type'] or '').lower() if 'strategy_type' in strategy_row.keys() else ''
    # Mountain Signal strategy identification
    if 'mountain' in name or 'mountain' in strategy_type:
        rules = load_mountain_signal_pe_rules()
        return rules or {}
    return {}


def compose_option_symbol(underlying: str, expiry: datetime.date, strike: int, option_type: str) -> str:
    year = expiry.strftime('%y')
    month = expiry.strftime('%b').upper()
    return f"{underlying}{year}{month}{int(strike)}{option_type.upper()}"


def preview_option_trade(
    kite_client: KiteConnect,
    strategy_row: sqlite3.Row,
    lot_count: int
) -> Dict[str, Any]:
    if lot_count <= 0:
        raise ValueError("Lot count must be greater than zero")

    rules = get_strategy_rule_config(strategy_row)
    instrument = (strategy_row['instrument'] or 'BANKNIFTY').upper()
    option_type = 'PE'

    strike_rounding_map = (rules.get('strike_rounding') or {})
    lot_sizes_map = (rules.get('lot_sizes') or {})
    option_trade_config = rules.get('option_trade') or {}
    evaluation_config = rules.get('evaluation') or {}
    signals_config = rules.get('signals') or {}
    pe_signal_config = signals_config.get('PE') or signals_config.get('pe') or {}

    strike_step = strike_rounding_map.get(instrument, 100 if 'BANK' in instrument else 50)
    lot_size = lot_sizes_map.get(instrument, 35 if 'BANK' in instrument else 75)
    stop_loss_percent = option_trade_config.get('stop_loss_percent', -0.17)
    target_percent = option_trade_config.get('target_percent', 0.45)
    evaluation_seconds = evaluation_config.get('seconds_before_close', 20)
    try:
        rsi_threshold = float(pe_signal_config.get('rsi_threshold', 70))
    except (TypeError, ValueError):
        rsi_threshold = 70.0
    try:
        candle_interval_minutes = int(strategy_row['candle_time'])
    except (KeyError, TypeError, ValueError):
        candle_interval_minutes = 5

    spot_price = get_spot_quote(kite_client, instrument)
    atm_strike = round_to_atm_price(spot_price, strike_step)
    today_ist = datetime.datetime.now(datetime.timezone.utc).astimezone(IST)
    expiry_date = get_next_monthly_expiry(today_ist.date())
    option_symbol = compose_option_symbol(instrument, expiry_date, atm_strike, option_type)

    quote = execute_with_retries(
        f"fetching option quote for {option_symbol}",
        lambda: kite_client.quote([f'NFO:{option_symbol}'])
    )
    option_quote = quote.get(f'NFO:{option_symbol}')
    if not option_quote:
        raise RuntimeError(f"Unable to fetch quote for option {option_symbol}")
    option_ltp = float(option_quote.get('last_price') or 0.0)
    if option_ltp <= 0:
        raise RuntimeError(f"Option {option_symbol} returned invalid LTP {option_ltp}")

    total_quantity = lot_size * lot_count
    required_capital = option_ltp * total_quantity
    stop_loss_price = round(option_ltp * (1 + stop_loss_percent), 2)
    target_price = round(option_ltp * (1 + target_percent), 2)

    return {
        'instrument': instrument,
        'optionSymbol': option_symbol,
        'optionType': option_type,
        'expiryDate': expiry_date.isoformat(),
        'strike': atm_strike,
        'spotPrice': spot_price,
        'optionLtp': option_ltp,
        'lotSize': lot_size,
        'lotCount': lot_count,
        'totalQuantity': total_quantity,
        'requiredCapital': required_capital,
        'stopLossPercent': stop_loss_percent,
        'targetPercent': target_percent,
        'stopLossPrice': stop_loss_price,
        'targetPrice': target_price,
        'evaluationSecondsBeforeClose': evaluation_seconds,
        'candleIntervalMinutes': candle_interval_minutes,
        'rsiThreshold': rsi_threshold,
    }


def place_preview_order(kite_client: KiteConnect, preview: Dict[str, Any], order_type: str) -> Dict[str, Any]:
    tradingsymbol = preview['optionSymbol']
    quantity = preview['totalQuantity']
    if quantity <= 0:
        raise ValueError("Quantity must be greater than zero")

    params = {
        'tradingsymbol': tradingsymbol,
        'exchange': kite_client.EXCHANGE_NFO,
        'transaction_type': kite_client.TRANSACTION_TYPE_BUY if order_type == 'ENTRY' else kite_client.TRANSACTION_TYPE_SELL,
        'quantity': int(quantity),
        'product': kite_client.PRODUCT_MIS,
        'order_type': kite_client.ORDER_TYPE_MARKET,
        'validity': kite_client.VALIDITY_DAY,
        'variety': kite_client.VARIETY_REGULAR,
    }

    order_id = kite_client.place_order(**params)
    return {
        'order_id': order_id,
        'params': params,
    }


def _process_single_live_trade_deployment(deployment: Dict[str, Any], now: datetime.datetime) -> None:
    deployment_id = deployment['id']
    user_id = deployment['user_id']
    status = deployment.get('status', STATUS_SCHEDULED)
    scheduled_raw = deployment.get('scheduled_start')
    scheduled_dt = ensure_datetime(scheduled_raw) if scheduled_raw else None
    state = deployment.get('state') or {}
    state.setdefault('history', [])

    history_entries = list(state.get('history') or [])

    def append_history_entry(
        message: str,
        *,
        level: str = 'info',
        category: str = 'system',
        meta: Optional[Dict[str, Any]] = None,
        timestamp: Optional[str] = None,
    ) -> None:
        entry = {
            'timestamp': timestamp or now.isoformat(),
            'level': level,
            'message': message,
            'category': category,
            'meta': _simplify_for_json(meta or {}),
        }
        history_entries.append(entry)

    if scheduled_dt and now < scheduled_dt:
        state.update({
            'phase': 'scheduled',
            'message': f"Deployment scheduled for {scheduled_dt.isoformat()}",
            'lastCheck': now.isoformat(),
        })
        live_update_deployment(
            deployment_id,
            state=state,
            last_run_at=now
        )
        return

    if status == STATUS_SCHEDULED:
        state.setdefault('history', []).append({
            'timestamp': now.isoformat(),
            'level': 'info',
            'message': f"Deployment activated at {now.isoformat()}",
        })
        state['phase'] = 'activating'
        state['message'] = 'Deployment is now active.'
        live_update_deployment(
            deployment_id,
            status=STATUS_ACTIVE,
            state=state,
            started_at=now,
            last_run_at=now,
            error_message=None
        )
        status = STATUS_ACTIVE

    if status in {STATUS_PAUSED, STATUS_STOPPED}:
        state.update({
            'lastCheck': now.isoformat(),
            'message': f"Deployment is {status}.",
        })
        live_update_deployment(
            deployment_id,
            state=state,
            last_run_at=now
        )
        return

    user_row = _get_user_record(user_id)
    if not user_row:
        live_update_deployment(
            deployment_id,
            status=STATUS_ERROR,
            state={
                **state,
                'phase': 'error',
                'message': 'User record not found. Please configure Zerodha credentials.',
                'lastCheck': now.isoformat(),
            },
            last_run_at=now,
            error_message='Missing user record'
        )
        return

    user = dict(user_row)
    api_key = user.get('app_key')
    access_token = deployment.get('kite_access_token')

    if not api_key or not access_token:
        live_update_deployment(
            deployment_id,
            status=STATUS_ERROR,
            state={
                **state,
                'phase': 'error',
                'message': 'Missing Zerodha API credentials or access token.',
                'lastCheck': now.isoformat(),
            },
            last_run_at=now,
            error_message='Missing Zerodha credentials or access token'
        )
        return

    try:
        kite_client = KiteConnect(api_key=api_key)
        kite_client.set_access_token(access_token)
        margins = execute_with_retries(
            f"fetching Kite margins for deployment {deployment_id}",
            lambda: kite_client.margins()
        )
        orders = execute_with_retries(
            f"fetching Kite orders for deployment {deployment_id}",
            lambda: kite_client.orders()
        )
        positions = execute_with_retries(
            f"fetching Kite positions for deployment {deployment_id}",
            lambda: kite_client.positions()
        )
    except kite_exceptions.TokenException as exc:
        logging.error("Live trade worker found invalid Kite session for deployment %s: %s", deployment_id, exc)
        state.update({
            'phase': 'error',
            'message': 'Zerodha session expired. Please re-authenticate from Settings > Zerodha Login.',
            'lastCheck': now.isoformat(),
        })
        live_update_deployment(
            deployment_id,
            status=STATUS_ERROR,
            state=state,
            last_run_at=now,
            error_message='Kite session expired'
        )
        return
    except Exception as exc:
        logging.exception("Live trade worker failed for deployment %s", deployment_id)
        state.update({
            'phase': 'error',
            'message': f'Kite API error: {exc}',
            'lastCheck': now.isoformat(),
        })
        live_update_deployment(
            deployment_id,
            status=STATUS_ERROR,
            state=state,
            last_run_at=now,
            error_message=str(exc)
        )
        return

    sanitized_orders = _sanitize_orders(orders if isinstance(orders, list) else [])
    sanitized_positions = _sanitize_positions(positions if isinstance(positions, dict) else {})
    open_positions = [pos for pos in sanitized_positions if pos.get('quantity')]

    strategy_obj = None
    strategy_id = deployment.get('strategy_id')
    for info in list(running_strategies.values()):
        if info.get('live_deployment_id') == deployment_id:
            strategy_obj = info.get('strategy')
            break
    if strategy_obj is None and strategy_id is not None:
        for info in list(running_strategies.values()):
            if info.get('db_id') == strategy_id and info.get('user_id') == user_id and not info.get('paper_trade'):
                strategy_obj = info.get('strategy')
                break
    if strategy_obj is None and strategy_id:
        strategy_row = _get_strategy_record(strategy_id, user_id)
        if strategy_row and access_token:
            _ensure_live_strategy_monitor(
                user_id,
                deployment_id,
                strategy_row,
                access_token=access_token,
                config=state.get('config'),
            )
            for info in list(running_strategies.values()):
                if info.get('live_deployment_id') == deployment_id:
                    strategy_obj = info.get('strategy')
                    break

    if strategy_obj and hasattr(strategy_obj, 'status'):
        strategy_status = getattr(strategy_obj, 'status', {})
        audit_trail = strategy_status.get('audit_trail', [])
        if isinstance(audit_trail, list):
            audit_cursor = state.get('auditCursor', 0)
            if not isinstance(audit_cursor, int) or audit_cursor < 0 or audit_cursor > len(audit_trail):
                audit_cursor = 0
            for audit_event in audit_trail[audit_cursor:]:
                formatted = _format_live_audit_event(audit_event)
                if not formatted:
                    continue
                event_timestamp = None
                if isinstance(audit_event, dict) and isinstance(audit_event.get('timestamp'), str):
                    event_timestamp = audit_event['timestamp']
                append_history_entry(
                    formatted['message'],
                    level=formatted.get('level', 'info'),
                    category=formatted.get('category', 'audit'),
                    meta=formatted.get('meta'),
                    timestamp=event_timestamp,
                )
            state['auditCursor'] = len(audit_trail)
            counts = Counter(
                (str(evt.get('event_type') or evt.get('type') or '').lower())
                for evt in audit_trail
                if isinstance(evt, dict)
            )
            state['eventStats'] = {
                'signalsIdentified': int(counts.get('signal_identified', 0)),
                'signalsIgnored': int(counts.get('entry_blocked', 0)),
                'tradeEntries': int(counts.get('entry', 0)),
                'tradeExits': int(counts.get('exit', 0) + counts.get('market_close_square_off', 0)),
                'stopLoss': int(counts.get('stop_loss', 0)),
                'targetHit': int(counts.get('target_hit', 0)),
            }
        signal_status = strategy_status.get('signal_status')
        previous_signal_status = state.get('lastSignalStatus')
        if signal_status and signal_status != previous_signal_status:
            lowered = signal_status.lower()
            if 'ignored' in lowered or 'blocked' in lowered or 'invalid' in lowered:
                status_category = 'signal_ignored'
                status_level = 'warning'
            elif 'rsi' in lowered:
                status_category = 'signal_ignored'
                status_level = 'warning'
            elif 'waiting' in lowered:
                status_category = 'signal_waiting'
                status_level = 'info'
            else:
                status_category = 'signal_status'
                status_level = 'info'
            append_history_entry(
                signal_status,
                level=status_level,
                category=status_category,
                meta={'eventType': 'signal_status'}
            )
            state['lastSignalStatus'] = signal_status
        insights = {
            'signalStatus': signal_status,
            'currentMessage': strategy_status.get('message'),
            'position': strategy_status.get('position'),
            'tradedInstrument': strategy_status.get('traded_instrument'),
            'entryPrice': strategy_status.get('entry_price'),
            'stopLossLevel': strategy_status.get('stop_loss_level'),
            'targetLevel': strategy_status.get('target_profit_level'),
            'pnl': strategy_status.get('pnl'),
        }
        state['strategyInsights'] = _simplify_for_json(insights)

    phase = 'monitoring'
    message = 'Monitoring market conditions for entry signals.'
    if open_positions:
        phase = 'position_open'
        message = 'Active position detected. Tracking live P&L.'

    available_cash = None
    try:
        if isinstance(margins, dict):
            equity = margins.get('equity') or {}
            available = equity.get('available') or {}
            live_balance = available.get('live_balance')
            mat_intraday = available.get('intraday')
            mat_cash = available.get('cash')
            available_cash = live_balance
            if available_cash is None:
                if mat_cash is not None and mat_intraday is not None:
                    available_cash = float(mat_cash) + float(mat_intraday)
                elif mat_cash is not None:
                    available_cash = float(mat_cash)
                elif mat_intraday is not None:
                    available_cash = float(mat_intraday)
    except Exception:
        available_cash = None

    total_pnl = 0.0
    for pos in sanitized_positions:
        try:
            pnl = pos.get('pnl')
            if pnl is not None:
                total_pnl += float(pnl)
        except (TypeError, ValueError):
            continue

    evaluation_seconds = state.get('config', {}).get('evaluationSecondsBeforeClose', 20)
    candle_interval = state.get('config', {}).get('candleIntervalMinutes', 5)
    ist_now = now.astimezone(IST)
    remainder_minutes = ist_now.minute % candle_interval
    close_minute_delta = (candle_interval - remainder_minutes) % candle_interval
    candle_close_time_ist = (
        ist_now.replace(second=0, microsecond=0) +
        datetime.timedelta(minutes=close_minute_delta, seconds=-ist_now.second)
    )
    if close_minute_delta == 0 and ist_now.second >= (60 - evaluation_seconds):
        candle_close_time_ist = ist_now.replace(second=0, microsecond=0)
    evaluation_target_ist = candle_close_time_ist - datetime.timedelta(seconds=evaluation_seconds)

    state.update({
        'phase': phase,
        'message': message,
        'lastCheck': now.isoformat(),
        'orders': sanitized_orders,
        'positions': sanitized_positions,
        'margin': {
            'availableCash': available_cash,
            'snapshot': margins if isinstance(margins, dict) else None,
        },
        'livePnl': total_pnl,
        'openOrdersCount': len(sanitized_orders),
        'openPositionsCount': len(open_positions),
        'lastEvaluationTarget': evaluation_target_ist.isoformat(),
    })

    state['history'] = history_entries[-200:]

    live_update_deployment(
        deployment_id,
        status=STATUS_ACTIVE,
        state=state,
        last_run_at=now,
        error_message=None
    )


def process_live_trade_deployments() -> None:
    if not live_trade_lock.acquire(blocking=False):
        return
    try:
        now = datetime.datetime.now(datetime.timezone.utc)
        deployments = live_get_deployments_for_processing(now)
        if not deployments:
            return
        for deployment in deployments:
            try:
                _process_single_live_trade_deployment(deployment, now)
            except Exception as exc:
                logging.exception("Unhandled error processing live deployment %s", deployment.get('id'))
                state = deployment.get('state') or {}
                state.update({
                    'phase': 'error',
                    'message': f'Unhandled worker error: {exc}',
                    'lastCheck': now.isoformat(),
                })
                live_update_deployment(
                    deployment['id'],
                    status=STATUS_ERROR,
                    state=state,
                    last_run_at=now,
                    error_message=str(exc)
                )
    finally:
        live_trade_lock.release()
from apscheduler.schedulers.background import BackgroundScheduler

# Scheduler for automatic data collection
def start_data_collection():
    with app.app_context():
        conn = get_db_connection()
        conn.execute('UPDATE tick_data_status SET status = "Running"')
        conn.commit()
        conn.close()
        logging.info("Started automatic data collection.")

def stop_data_collection():
    with app.app_context():
        conn = get_db_connection()
        conn.execute('UPDATE tick_data_status SET status = "Stopped"')
        conn.commit()
        conn.close()
        logging.info("Stopped automatic data collection.")

scheduler = BackgroundScheduler()
scheduler.add_job(func=start_data_collection, trigger="cron", day_of_week='mon-fri', hour=9, minute=15)
scheduler.add_job(func=stop_data_collection, trigger="cron", day_of_week='mon-fri', hour=15, minute=30)
scheduler.add_job(func=process_live_trade_deployments, trigger="interval", seconds=30, max_instances=1)
scheduler.start()

@app.before_request
def make_session_permanent():
    session.permanent = False

@app.before_request
def log_request():
    """Log incoming requests for debugging"""
    if request.path.startswith('/api/rl'):
        logging.info(f"[RL] Incoming request: {request.method} {request.path}")

@app.after_request
def add_cors_headers(response):
    """Ensure CORS headers include the request origin when credentials are used."""
    try:
        allowed_origins = config.CORS_ORIGINS if isinstance(config.CORS_ORIGINS, (list, tuple)) else [config.CORS_ORIGINS]
        origin = request.headers.get('Origin')
        if origin and origin in allowed_origins:
            response.headers['Access-Control-Allow-Origin'] = origin
        elif allowed_origins:
            response.headers['Access-Control-Allow-Origin'] = allowed_origins[0]
        response.headers['Access-Control-Allow-Credentials'] = 'true'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
        response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
    except Exception as cors_err:
        logging.debug(f"CORS header injection failed: {cors_err}")
    return response

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors with JSON response for API routes"""
    # Don't interfere with Socket.IO paths
    if request.path.startswith('/socket.io/'):
        # Let Socket.IO handle it
        return error
    if request.path.startswith('/api/'):
        return jsonify({'status': 'error', 'message': 'Route not found'}), 404
    # For non-API routes, return a simple text response
    return 'Not Found', 404

# Note: 405 errors for /socket.io/ should be handled by Flask-SocketIO automatically
# Don't add a 405 handler - let Flask-SocketIO handle Socket.IO paths
# Flask-SocketIO registers its own middleware to handle /socket.io/ paths

# Initialize KiteConnect
kite = KiteConnect(api_key="default_api_key") # The API key will be set dynamically

# In-memory storage for running strategies
running_strategies = {}
paper_trade_strategies = {}  # Store paper trade strategy instances

# Ticker instance
ticker = None

# Synchronization lock for live trade scheduler
live_trade_lock = Lock()

# Initialize paper trade tables on startup
def init_paper_trade_tables():
    """Create paper trade tables if they don't exist"""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Create paper_trade_sessions table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS paper_trade_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                strategy_id INTEGER NOT NULL,
                strategy_name TEXT NOT NULL,
                instrument TEXT NOT NULL,
                expiry_type TEXT NOT NULL,
                candle_time TEXT NOT NULL,
                ema_period INTEGER,
                started_at DATETIME NOT NULL,
                stopped_at DATETIME,
                status TEXT NOT NULL DEFAULT 'running',
                total_trades INTEGER DEFAULT 0,
                total_pnl REAL DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id),
                FOREIGN KEY (strategy_id) REFERENCES strategies (id)
            )
        """)
        
        # Create paper_trade_audit_trail table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS paper_trade_audit_trail (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL,
                timestamp DATETIME NOT NULL,
                log_type TEXT NOT NULL,
                message TEXT NOT NULL,
                details TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (session_id) REFERENCES paper_trade_sessions (id) ON DELETE CASCADE
            )
        """)
        
        # Create index for faster queries
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_session_timestamp ON paper_trade_audit_trail(session_id, timestamp)")
        
        conn.commit()
        conn.close()
        logging.info("Paper trade tables initialized successfully")
    except Exception as e:
        logging.error(f"Error initializing paper trade tables: {e}", exc_info=True)

# Initialize tables on startup
init_paper_trade_tables()

def send_email(to_email, otp):
    port = 465  # For SSL
    smtp_server = config.SMTP_SERVER
    sender_email = config.EMAIL_FROM
    receiver_email = to_email
    password = config.PASSWORD_EMAIL

    message = MIMEMultipart("alternative")
    message["Subject"] = "Your OTP for DRP Infotech Trading Platform"
    message["From"] = f"DRP Infotech Pvt Ltd <{sender_email}>"
    message["To"] = receiver_email

    text = f"""
    DRP Infotech Pvt Ltd - Algorithmic Trading Platform
    
    Hi,
    Your OTP for login is: {otp}
    
    This OTP is valid for 10 minutes.
    
    If you didn't request this OTP, please ignore this email.
    
    Best regards,
    DRP Infotech Pvt Ltd
    Email: contact@drpinfotech.com
    Website: drpinfotech.com
    """
    html = f"""
    <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
            <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="background-color: #0d6efd; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0;">
                    <h2 style="margin: 0;">DRP Infotech Pvt Ltd</h2>
                    <p style="margin: 5px 0 0 0; font-size: 14px;">Algorithmic Trading Platform</p>
                </div>
                <div style="background-color: #f8f9fa; padding: 30px; border-radius: 0 0 5px 5px;">
                    <h3 style="color: #0d6efd; margin-top: 0;">OTP Verification</h3>
                    <p>Hi,</p>
                    <p>Your OTP for login is:</p>
                    <div style="background-color: white; padding: 20px; text-align: center; border: 2px dashed #0d6efd; border-radius: 5px; margin: 20px 0;">
                        <h1 style="color: #0d6efd; margin: 0; font-size: 32px; letter-spacing: 5px;">{otp}</h1>
                    </div>
                    <p style="color: #666; font-size: 14px;">This OTP is valid for <strong>10 minutes</strong>.</p>
                    <p style="color: #666; font-size: 14px;">If you didn't request this OTP, please ignore this email.</p>
                    <hr style="border: none; border-top: 1px solid #dee2e6; margin: 30px 0;">
                    <div style="text-align: center; color: #666; font-size: 12px;">
                        <p style="margin: 5px 0;"><strong>DRP Infotech Pvt Ltd</strong></p>
                        <p style="margin: 5px 0;">Email: <a href="mailto:contact@drpinfotech.com" style="color: #0d6efd; text-decoration: none;">contact@drpinfotech.com</a></p>
                        <p style="margin: 5px 0;">Website: <a href="https://drpinfotech.com" style="color: #0d6efd; text-decoration: none;">drpinfotech.com</a></p>
                    </div>
                </div>
            </div>
        </body>
    </html>
    """

    part1 = MIMEText(text, "plain")
    part2 = MIMEText(html, "html")

    message.attach(part1)
    message.attach(part2)

    context = ssl.create_default_context()
    with smtplib.SMTP_SSL(smtp_server, port, context=context) as server:
        server.login(sender_email, password)
        server.sendmail(sender_email, receiver_email, message.as_string())

def send_support_email(name: str, email: str, mobile: str, inquiry: str):
    port = 465
    smtp_server = config.SMTP_SERVER
    sender_email = config.EMAIL_FROM
    receiver_email = config.EMAIL_FROM
    password = config.PASSWORD_EMAIL

    message = MIMEMultipart("alternative")
    message["Subject"] = "New Support Inquiry - DRP Infotech Trading Platform"
    message["From"] = f"DRP Infotech Pvt Ltd <{sender_email}>"
    message["To"] = receiver_email

    text = f"""
    New support inquiry received

    Name: {name}
    Email: {email}
    Mobile: {mobile}

    Message:
    {inquiry}
    """

    html = f"""
    <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #0d6efd; color: white; padding: 18px; text-align: center; border-radius: 5px 5px 0 0;">
            <h2 style="margin: 0;">New Support Inquiry</h2>
            <p style="margin: 5px 0 0 0; font-size: 14px;">DRP Infotech Trading Platform</p>
          </div>
          <div style="background-color: #f8f9fa; padding: 24px; border-radius: 0 0 5px 5px;">
            <h4 style="color: #0d6efd; margin-top: 0;">Contact Details</h4>
            <p><strong>Name:</strong> {name}</p>
            <p><strong>Email:</strong> <a href="mailto:{email}">{email}</a></p>
            <p><strong>Mobile:</strong> {mobile}</p>
            <hr style="border: none; border-top: 1px solid #dee2e6; margin: 24px 0;">
            <h4 style="color: #0d6efd;">Message</h4>
            <p style="white-space: pre-wrap;">{inquiry}</p>
          </div>
        </div>
      </body>
    </html>
    """

    message.attach(MIMEText(text, "plain"))
    message.attach(MIMEText(html, "html"))

    context = ssl.create_default_context()
    with smtplib.SMTP_SSL(smtp_server, port, context=context) as server:
        server.login(sender_email, password)
        server.sendmail(sender_email, receiver_email, message.as_string())

@app.route('/favicon.ico')
def favicon():
    return '', 204

@app.route('/api/chart_data')
def api_chart_data():
    if 'user_id' not in session:
        return jsonify({'status': 'error', 'message': 'User not logged in'}), 401

    date_str = request.args.get('date')
    instrument = request.args.get('instrument', 'BANKNIFTY')  # Default: BANKNIFTY
    interval = request.args.get('interval', '5m')  # 1m,3m,5m,15m,30m,60m
    try:
        if not date_str:
            return jsonify({'candles': [], 'ema': []})
        # Parse selected date (YYYY-MM-DD)
        selected_date = datetime.datetime.strptime(date_str, '%Y-%m-%d').date()
        # Build from/to with market timings 09:15 to 15:30
        start_dt = datetime.datetime.combine(selected_date, datetime.time(9, 15))
        end_dt = datetime.datetime.combine(selected_date, datetime.time(15, 30))

        # Resolve instrument token for index
        if instrument.upper() == 'NIFTY':
            token = 256265
        elif instrument.upper() == 'BANKNIFTY':
            token = 260105
        else:
            return jsonify({'candles': [], 'ema': []})

        # Map interval to Kite granularity
        interval_map = {
            '1m': 'minute',
            '3m': '3minute',
            '5m': '5minute',
            '15m': '15minute',
            '30m': '30minute',
            '60m': '60minute'
        }
        kite_interval = interval_map.get(interval, '5minute')

        # Get previous trading day for RSI calculation (need at least 14 periods)
        # Calculate how many candles we need based on interval
        interval_minutes = {
            '1m': 1, '3m': 3, '5m': 5, '15m': 15, '30m': 30, '60m': 60
        }.get(interval, 5)
        
        # Need at least 14 candles for RSI 14, fetch 20 to be safe
        candles_needed = 20
        minutes_needed = candles_needed * interval_minutes
        
        # Get previous trading day (skip weekends)
        prev_date = selected_date
        days_back = 0
        while days_back < 5:  # Max 5 days back to find a trading day
            prev_date = prev_date - datetime.timedelta(days=1)
            days_back += 1
            # Skip weekends (Saturday=5, Sunday=6)
            if prev_date.weekday() < 5:
                break
        
        # Fetch previous day's data (last portion of trading session)
        prev_start_dt = datetime.datetime.combine(prev_date, datetime.time(15, 30)) - datetime.timedelta(minutes=minutes_needed)
        prev_end_dt = datetime.datetime.combine(prev_date, datetime.time(15, 30))
        
        def _fetch_history(client: KiteConnect) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
            try:
                hist_today_local = execute_with_retries(
                    f"fetching historical data for {instrument} on {selected_date}",
                    lambda: client.historical_data(token, start_dt, end_dt, kite_interval)
                )
            except kite_exceptions.TokenException as err:
                logging.error(f"Invalid Kite session while fetching today's data: {err}")
                raise
            except Exception as err:
                logging.error(f"Error fetching historical data for today: {err}")
                raise

            hist_prev_local: List[Dict[str, Any]] = []
            try:
                hist_prev_local = execute_with_retries(
                    f"fetching previous day data for {instrument} on {prev_date}",
                    lambda: client.historical_data(token, prev_start_dt, prev_end_dt, kite_interval)
                )
                if len(hist_prev_local) > candles_needed:
                    hist_prev_local = hist_prev_local[-candles_needed:]
            except kite_exceptions.TokenException as err:
                logging.error(f"Invalid Kite session while fetching previous data: {err}")
                raise
            except Exception as err:
                logging.warning(
                    f"Could not fetch previous day's data for RSI warm-up: {err}. "
                    f"RSI will start from candle {candles_needed + 1}"
                )
                hist_prev_local = []

            return hist_today_local, hist_prev_local

        try:
            hist_today, hist_prev = _with_valid_kite_client(
                session['user_id'],
                f"historical data fetch for {instrument}",
                _fetch_history
            )
        except kite_exceptions.TokenException:
            return jsonify({'candles': [], 'ema': [], 'authExpired': True})
        except RuntimeError as err:
            logging.error(f"Error preparing Zerodha session for historical data: {err}")
            return jsonify({'candles': [], 'ema': [], 'message': str(err)}), 400
        except Exception as err:
            logging.error(f"Unexpected error fetching historical data: {err}")
            return jsonify({'candles': [], 'ema': []}), 500

        # Combine: previous day's data first, then today's data
        # This ensures RSI calculation has enough historical data
        hist = hist_prev + hist_today

        # Prepare candles and compute indicators
        candles = []
        closes = []
        ema5 = []
        ema20 = []
        rsi14 = []
        for row in hist:
            ts = row.get('date')
            # Kite returns datetime; serialize to ISO string
            if isinstance(ts, (datetime.datetime, datetime.date)):
                ts_str = ts.isoformat()
            else:
                ts_str = str(ts)
            o = float(row.get('open', 0) or 0)
            h = float(row.get('high', 0) or 0)
            l = float(row.get('low', 0) or 0)
            c = float(row.get('close', 0) or 0)
            candles.append({'x': ts_str, 'o': o, 'h': h, 'l': l, 'c': c})
            closes.append(c)

        # EMA helper
        def compute_ema(values, period):
            if not values:
                return []
            mult = 2 / (period + 1)
            ema_vals = []
            ema_curr = float(values[0])
            for i, val in enumerate(values):
                ema_curr = (val - ema_curr) * mult + ema_curr if i > 0 else ema_curr
                ema_vals.append(ema_curr)
            return ema_vals

        # RSI(14) simple Wilder's method
        def compute_rsi(values, period=14):
            if len(values) < period + 1:
                return [None] * len(values)
            gains = []
            losses = []
            for i in range(1, period + 1):
                change = values[i] - values[i - 1]
                gains.append(max(change, 0))
                losses.append(abs(min(change, 0)))
            avg_gain = sum(gains) / period
            avg_loss = sum(losses) / period
            rsi_series = [None] * period
            for i in range(period, len(values)):
                if i > period:
                    change = values[i] - values[i - 1]
                    gain = max(change, 0)
                    loss = abs(min(change, 0))
                    avg_gain = (avg_gain * (period - 1) + gain) / period
                    avg_loss = (avg_loss * (period - 1) + loss) / period
                rs = (avg_gain / avg_loss) if avg_loss != 0 else float('inf')
                rsi_series.append(100 - (100 / (1 + rs)))
            return rsi_series

        if closes:
            ema5_vals = compute_ema(closes, 5)
            ema20_vals = compute_ema(closes, 20)
            rsi_vals = compute_rsi(closes, 14)
            
            # Separate today's candles from previous day's warm-up data
            # Only return today's candles and indicators
            prev_count = len(hist_prev)
            today_candles = candles[prev_count:]
            today_ema5_vals = ema5_vals[prev_count:]
            today_ema20_vals = ema20_vals[prev_count:]
            today_rsi_vals = rsi_vals[prev_count:]
            
            # Build response with only today's data
            for i in range(len(today_candles)):
                ema5.append({'x': today_candles[i]['x'], 'y': float(today_ema5_vals[i]) if i < len(today_ema5_vals) else None})
                ema20.append({'x': today_candles[i]['x'], 'y': float(today_ema20_vals[i]) if i < len(today_ema20_vals) else None})
                # RSI should now be available from first candle of today (index 0)
                rsi14.append({'x': today_candles[i]['x'], 'y': float(today_rsi_vals[i]) if i < len(today_rsi_vals) and today_rsi_vals[i] is not None else None})
            
            # Return today's candles (not the combined dataset)
            return jsonify({'candles': today_candles, 'ema5': ema5, 'ema20': ema20, 'rsi14': rsi14})
        
        return jsonify({'candles': [], 'ema5': [], 'ema20': [], 'rsi14': []})
    except Exception as e:
        logging.error(f"/api/chart_data error: {e}", exc_info=True)
        return jsonify({'candles': [], 'ema': []}), 200


@app.route('/api/option_ltp', methods=['GET'])
def api_option_ltp():
    if 'user_id' not in session:
        return jsonify({'status': 'error', 'message': 'User not logged in'}), 401

    symbols_raw = request.args.get('symbols', '')
    if not symbols_raw:
        return jsonify({'status': 'error', 'message': 'No symbols provided'}), 400

    symbol_list = [s.strip().upper() for s in symbols_raw.split(',') if s.strip()]
    if not symbol_list:
        return jsonify({'status': 'error', 'message': 'No valid symbols provided'}), 400

    try:
        if 'access_token' in session:
            kite.set_access_token(session['access_token'])
    except Exception as e:
        logging.error(f"Error setting access token for option LTP: {e}")

    try:
        ltp_request_tokens = []
        symbol_map = {}
        for sym in symbol_list:
            token = sym if sym.startswith('NFO:') else f"NFO:{sym}"
            ltp_request_tokens.append(token)
            symbol_map[token] = sym

        ltp_response = execute_with_retries(
            f"fetching LTP for {len(ltp_request_tokens)} option symbols",
            lambda: kite.ltp(ltp_request_tokens)
        )

        result = {}
        for token_key, data in ltp_response.items():
            sym = symbol_map.get(token_key, token_key.replace('NFO:', ''))
            result[sym] = data.get('last_price')

        return jsonify({'status': 'success', 'ltp': result})
    except kite_exceptions.TokenException as e:
        logging.error(f"Error fetching option LTP due to invalid session: {e}")
        session.pop('access_token', None)
        return jsonify({'status': 'error', 'message': 'Zerodha session expired. Please login again.'}), 401
    except Exception as e:
        logging.error(f"Error fetching option LTP: {e}", exc_info=True)
        return jsonify({'status': 'error', 'message': str(e)}), 500


@app.route('/api/rules/mountain_signal', methods=['GET'])
def api_rules_mountain_signal():
    """Expose Mountain Signal (PE) rule configuration for clients."""
    try:
        rules_data = load_mountain_signal_pe_rules()
        return jsonify({'status': 'success', 'rules': rules_data})
    except Exception as e:
        logging.error(f"Error loading Mountain Signal rules: {e}", exc_info=True)
        return jsonify({'status': 'error', 'message': str(e)}), 500


@app.route('/api/option_trade_history', methods=['GET'])
def api_option_trade_history():
    if 'user_id' not in session:
        return jsonify({'status': 'error', 'message': 'User not logged in'}), 401

    instrument_filter = request.args.get('instrument')
    trades_response = []

    for strategy_id, pt_info in paper_trade_strategies.items():
        strategy = pt_info.get('strategy')
        if not strategy or not hasattr(strategy, 'get_option_trade_history'):
            continue

        if instrument_filter and strategy.instrument != instrument_filter:
            continue

        option_trades = strategy.get_option_trade_history()
        for trade in option_trades:
            try:
                trades_response.append({
                    'strategyId': strategy_id,
                    'signalTime': trade.get('signal_time'),
                    'signalType': trade.get('signal_type'),
                    'signalHigh': float(trade.get('signal_high', 0)),
                    'signalLow': float(trade.get('signal_low', 0)),
                    'indexAtEntry': float(trade.get('index_at_entry', 0)),
                    'atmStrike': float(trade.get('atm_strike', 0)),
                    'optionSymbol': trade.get('option_symbol'),
                    'entryTime': trade.get('entry_time'),
                    'optionEntryPrice': float(trade.get('option_entry_price', 0)),
                    'stopLossPrice': float(trade.get('stop_loss_price', 0)),
                    'targetPrice': float(trade.get('target_price', 0)),
                    'optionExitPrice': float(trade['option_exit_price']) if trade.get('option_exit_price') is not None else None,
                    'exitTime': trade.get('exit_time'),
                    'exitType': trade.get('exit_type'),
                    'pnl': float(trade['pnl']) if trade.get('pnl') is not None else None,
                    'pnlPercent': float(trade['pnl_percent']) if trade.get('pnl_percent') is not None else None,
                    'status': trade.get('status', 'open')
                })
            except Exception as error:
                logging.error(f"Error serializing option trade history: {error}", exc_info=True)
                continue

    return jsonify({'status': 'success', 'trades': trades_response})

@app.route("/")
def index():
    if 'user_id' in session:
        return redirect(f"{config.FRONTEND_URL}/dashboard")
    return render_template("login.html")

@app.route('/signup', methods=['GET', 'POST'])
def signup():
    if request.method == 'POST':
        mobile = request.form['mobile']
        email = request.form['email']
        app_key = request.form['app_key']
        app_secret = request.form['app_secret']

        conn = get_db_connection()
        user = conn.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()

        if user:
            flash('Email already exists!', 'error')
            return redirect('/signup')

        otp = secrets.token_hex(3).upper()
        otp_expiry = datetime.datetime.now() + datetime.timedelta(minutes=10)

        conn.execute('INSERT INTO users (mobile, email, app_key, app_secret, otp, otp_expiry) VALUES (?, ?, ?, ?, ?, ?)',
                     (mobile, email, app_key, app_secret, otp, otp_expiry))
        conn.commit()
        conn.close()

        send_email(email, otp)

        return redirect(f'/verify_otp?email={email}')
    return render_template('signup.html')

@app.route('/api/signup', methods=['POST'])
def api_signup():
    """API endpoint for signup that accepts JSON"""
    try:
        if request.is_json:
            data = request.get_json()
            mobile = data.get('mobile')
            email = data.get('email')
        else:
            mobile = request.form.get('mobile')
            email = request.form.get('email')
        
        if not all([mobile, email]):
            return jsonify({'status': 'error', 'message': 'Mobile and email are required'}), 400

        conn = get_db_connection()
        user = conn.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()

        if user:
            conn.close()
            return jsonify({
                'status': 'error',
                'message': 'Email already exists!'
            }), 400

        otp = secrets.token_hex(3).upper()
        otp_expiry = datetime.datetime.now() + datetime.timedelta(minutes=10)

        conn.execute('INSERT INTO users (mobile, email, otp, otp_expiry) VALUES (?, ?, ?, ?)',
                     (mobile, email, otp, otp_expiry))
        conn.commit()
        conn.close()

        send_email(email, otp)
        
        return jsonify({
            'status': 'success',
            'message': 'Signup successful! Please verify your OTP and then login.',
            'redirect': '/verify-otp'
        })
    except Exception as e:
        logging.error(f"Error in api_signup: {e}")
        return jsonify({
            'status': 'error',
            'message': 'An error occurred. Please try again.'
        }), 500

@app.route('/verify_otp', methods=['GET', 'POST'])
def verify_otp():
    email = request.args.get('email')
    if request.method == 'POST':
        otp_entered = request.form['otp']
        email = request.form['email']

        conn = get_db_connection()
        user = conn.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()

        if user and user['otp'] == otp_entered and user['otp_expiry'] > datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'):
            if not user['email_verified']:
                conn.execute('UPDATE users SET email_verified = 1 WHERE email = ?', (email,))
                conn.commit()
                conn.close()
                flash('Registration successful! Please log in.', 'success')
                return redirect('/login')
            else:
                conn.close()
                session['user_id'] = user['id']
                return redirect('/welcome')
        else:
            return render_template('verify_otp.html', email=email, error='Invalid OTP or OTP expired!')

    return render_template('verify_otp.html', email=email)

@app.route('/api/verify_otp', methods=['GET', 'POST', 'OPTIONS'])
@app.route('/api/verify-otp', methods=['GET', 'POST', 'OPTIONS'])
def api_verify_otp():
    """API endpoint for OTP verification that accepts JSON"""
    if request.method == 'OPTIONS':
        # Handle CORS preflight
        return '', 200
    
    if request.method == 'GET':
        # GET request - return endpoint information
        return jsonify({
            'status': 'success',
            'message': 'OTP verification endpoint is available',
            'methods': ['POST'],
            'description': 'Send POST request with JSON body containing "email" and "otp" fields'
        }), 200
    
    try:
        # Log request details for debugging
        logging.info(f"Verify OTP request - Content-Type: {request.content_type}, Method: {request.method}")
        
        # Try to get JSON data
        data = None
        if request.is_json:
            data = request.get_json(silent=True)
            logging.info(f"Verify OTP request - Parsed JSON: {data}")
        elif request.content_type and 'application/json' in request.content_type:
            try:
                data = request.get_json(force=True)
                logging.info(f"Verify OTP request - Force parsed JSON: {data}")
            except Exception as e:
                logging.error(f"Verify OTP request - Failed to parse JSON: {e}")
                logging.info(f"Verify OTP request - Raw data: {request.data}")
        
        if data:
            otp_entered = data.get('otp')
            email = data.get('email')
        else:
            # Fallback to form data
            otp_entered = request.form.get('otp')
            email = request.form.get('email')
            logging.info(f"Verify OTP request - Using form data, email: {email}, otp: {'*' * len(otp_entered) if otp_entered else 'None'}")
        
        if not all([otp_entered, email]):
            logging.warning("Verify OTP request - Missing OTP or email")
            return jsonify({
                'status': 'error', 
                'message': 'OTP and email are required',
                'debug': {
                    'has_otp': bool(otp_entered),
                    'has_email': bool(email),
                    'content_type': request.content_type
                }
            }), 400

        conn = get_db_connection()
        user = conn.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()

        if not user:
            conn.close()
            return jsonify({
                'status': 'error',
                'message': 'User not found'
            }), 404

        # Check if OTP is valid and not expired
        current_time = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        if user['otp'] == otp_entered and user['otp_expiry'] > current_time:
            if not user['email_verified']:
                # First time verification - new registration
                conn.execute('UPDATE users SET email_verified = 1 WHERE email = ?', (email,))
                conn.commit()
                conn.close()
                return jsonify({
                    'status': 'success',
                    'message': 'Registration successful! Please log in.',
                    'redirect': '/login'  # Relative path for React Router
                })
            else:
                # Already verified - login
                conn.close()
                session['user_id'] = user['id']
                return jsonify({
                    'status': 'success',
                    'message': 'OTP verified successfully!',
                    'redirect': '/welcome'  # Relative path for React Router
                })
        else:
            conn.close()
            return jsonify({
                'status': 'error',
                'message': 'Invalid OTP or OTP expired!'
            }), 400
    except Exception as e:
        logging.error(f"Error in api_verify_otp: {e}")
        return jsonify({
            'status': 'error',
            'message': 'An error occurred. Please try again.'
        }), 500

@app.route('/welcome')
def welcome():
    if 'user_id' not in session:
        return redirect('/')
    return render_template('welcome.html')

@app.route('/zerodha_setup', methods=['GET', 'POST'])
def zerodha_setup():
    if 'user_id' not in session:
        return redirect('/')

    error = request.args.get('error')

    if request.method == 'POST':
        app_key = request.form['app_key']
        app_secret = request.form['app_secret']

        conn = get_db_connection()
        conn.execute('UPDATE users SET app_key = ?, app_secret = ? WHERE id = ?',
                     (app_key, app_secret, session['user_id']))
        conn.commit()
        conn.close()

        return redirect('/dashboard')

    return render_template('zerodha_setup.html', error=error)

@app.route("/login", methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        email = request.form['email']
        conn = get_db_connection()
        user = conn.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()
        conn.close()

        if user:
            otp = secrets.token_hex(3).upper()
            otp_expiry = datetime.datetime.now() + datetime.timedelta(minutes=10)

            conn = get_db_connection()
            conn.execute('UPDATE users SET otp = ?, otp_expiry = ? WHERE id = ?',
                         (otp, otp_expiry.strftime('%Y-%m-%d %H:%M:%S'), user['id']))
            conn.commit()
            conn.close()

            send_email(email, otp)
            return redirect(f'{config.FRONTEND_URL}/verify-otp?email={email}')
        else:
            flash('User not found. Please sign up.', 'error')
            return redirect(f'{config.FRONTEND_URL}/signup')

    return render_template("login.html")

@app.route("/api/login", methods=['GET', 'POST', 'OPTIONS'])
def api_login():
    """API endpoint for login that accepts JSON"""
    if request.method == 'OPTIONS':
        # Handle CORS preflight
        return '', 200
    
    if request.method == 'GET':
        # GET request - return endpoint information
        return jsonify({
            'status': 'success',
            'message': 'Login endpoint is available',
            'methods': ['POST'],
            'description': 'Send POST request with JSON body containing "email" field'
        }), 200
    
    try:
        # Log request details for debugging
        logging.info(f"Login request - Content-Type: {request.content_type}, Method: {request.method}")
        logging.info(f"Login request - Headers: {dict(request.headers)}")
        
        # Try to get JSON data
        data = None
        if request.is_json:
            data = request.get_json(silent=True)
            logging.info(f"Login request - Parsed JSON: {data}")
        elif request.content_type and 'application/json' in request.content_type:
            try:
                data = request.get_json(force=True)
                logging.info(f"Login request - Force parsed JSON: {data}")
            except Exception as e:
                logging.error(f"Login request - Failed to parse JSON: {e}")
                logging.info(f"Login request - Raw data: {request.data}")
        
        if data:
            email = data.get('email')
        else:
            # Fallback to form data
            email = request.form.get('email')
            logging.info(f"Login request - Using form data, email: {email}")
        
        if not email:
            logging.warning("Login request - Email is missing")
            return jsonify({
                'status': 'error', 
                'message': 'Email is required',
                'debug': {
                    'content_type': request.content_type,
                    'has_json': request.is_json,
                    'form_data': dict(request.form) if request.form else None
                }
            }), 400
        
        # Use try-finally to ensure connection is always closed
        try:
            conn = get_db_connection()
            try:
                user = conn.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()
            finally:
                conn.close()
        except SqliteOperationalError as db_err:
            if 'locked' in str(db_err).lower():
                logging.error(f"Database locked in api_login (SELECT): {db_err}")
                return jsonify({
                    'status': 'error',
                    'message': 'Database is temporarily busy. Please try again in a moment.'
                }), 503  # Service Unavailable
            raise

        if user:
            otp = secrets.token_hex(3).upper()
            otp_expiry = datetime.datetime.now() + datetime.timedelta(minutes=10)

            # Use try-finally to ensure connection is always closed
            try:
                conn = get_db_connection()
                try:
                    conn.execute('UPDATE users SET otp = ?, otp_expiry = ? WHERE id = ?',
                                 (otp, otp_expiry.strftime('%Y-%m-%d %H:%M:%S'), user['id']))
                    conn.commit()
                finally:
                    conn.close()
            except SqliteOperationalError as db_err:
                if 'locked' in str(db_err).lower():
                    logging.error(f"Database locked in api_login (UPDATE): {db_err}")
                    return jsonify({
                        'status': 'error',
                        'message': 'Database is temporarily busy. Please try again in a moment.'
                    }), 503  # Service Unavailable
                raise

            send_email(email, otp)
            return jsonify({
                'status': 'success',
                'message': 'OTP sent successfully! Please check your email.',
                'redirect': '/verify-otp'  # Relative path for React Router
            })
        else:
            return jsonify({
                'status': 'error',
                'message': 'User not found. Please sign up.'
            }), 404
    except Exception as e:
        logging.error(f"Error in api_login: {e}")
        return jsonify({
            'status': 'error',
            'message': 'An error occurred. Please try again.'
        }), 500


@app.route("/zerodha_login")
@app.route("/api/zerodha_login")  # API alias for consistency
def zerodha_login():
    if 'user_id' not in session:
        # Use helper function that works in both local and production
        frontend_url = _get_frontend_url()
        return redirect(f"{frontend_url}/")

    conn = get_db_connection()
    user = conn.execute('SELECT * FROM users WHERE id = ?', (session['user_id'],)).fetchone()
    conn.close()

    if not user or not user['app_key'] or not user['app_secret']:
        # Use helper function that works in both local and production
        frontend_url = _get_frontend_url()
        return redirect(f"{frontend_url}/welcome?credentials=missing")

    kite.api_key = user['app_key']
    login_url = kite.login_url()
    return redirect(login_url)


@app.route("/callback")
def callback():
    if 'user_id' not in session:
        # Use helper function that works in both local and production
        frontend_url = _get_frontend_url()
        return redirect(f"{frontend_url}/")

    request_token = request.args.get("request_token")
    if not request_token:
        return "Request token not found", 400

    conn = get_db_connection()
    user = conn.execute('SELECT * FROM users WHERE id = ?', (session['user_id'],)).fetchone()
    conn.close()

    if not user or not user['app_key'] or not user['app_secret']:
        return "App key or secret not configured", 400

    kite.api_key = user['app_key']

    try:
        data = kite.generate_session(request_token, api_secret=user['app_secret'])
        access_token = data["access_token"]
        session['access_token'] = access_token
        kite.set_access_token(access_token)
        
        # Update stored token in database
        _update_user_access_token(session['user_id'], access_token)
        
        # Use helper function that works in both local and production
        frontend_url = _get_frontend_url()
        return redirect(f"{frontend_url}/dashboard")
    except Exception as e:
        logging.error(f"Error generating session: {e}")
        return "Error generating session", 500

@app.route("/dashboard")
def dashboard():
    if 'user_id' not in session:
        return redirect("/")

    conn = get_db_connection()
    user = conn.execute('SELECT * FROM users WHERE id = ?', (session['user_id'],)).fetchone()
    
    strategies = conn.execute('SELECT * FROM strategies WHERE user_id = ?', (session['user_id'],)).fetchall()
    conn.close()

    if not user['email_verified']:
        return redirect(f"/verify_otp?email={user['email']}")
        
    try:
        if 'access_token' not in session:
            return redirect('/welcome')

        kite.set_access_token(session['access_token'])
        profile = execute_with_retries("fetching Kite profile for dashboard", lambda: kite.profile())
        margins = execute_with_retries("fetching Kite margins for dashboard", lambda: kite.margins())
        user_name = profile.get("user_name")
        balance = margins.get("equity", {}).get("available", {}).get("live_balance")
        return render_template("dashboard.html", user_name=user_name, balance=balance, access_token=session.get('access_token'), strategies=strategies)
    except kite_exceptions.TokenException as e:
        logging.error(f"Error fetching data for dashboard: {e}")
        session.pop('access_token', None)
        flash('Your Zerodha session is invalid or expired. Please log in again.', 'error')
        return redirect('/welcome')
    except Exception as e:
        logging.error(f"Error fetching data for dashboard: {e}")
        # If the access token is invalid, redirect to the login page
        if "Invalid `api_key` or `access_token`" in str(e):
            session.pop('access_token', None)
            flash('Your Zerodha session is invalid or expired. Please log in again.', 'error')
            return redirect('/welcome')
        flash('An unexpected error occurred while fetching dashboard data.', 'error')
        return redirect('/welcome')


@app.route("/logout")
def logout():
    session.pop('access_token', None)
    session.pop('user_id', None)
    return redirect("/")

@app.route("/api/logout", methods=['POST'])
def api_logout():
    session.pop('access_token', None)
    session.pop('user_id', None)
    return jsonify({'status': 'success', 'message': 'Logged out successfully'})

@app.route("/api/admin/check")
def api_admin_check():
    """Check if current user is admin"""
    if 'user_id' not in session:
        return jsonify({'is_admin': False}), 200
    
    is_admin = _require_admin()
    return jsonify({'is_admin': is_admin}), 200

@app.route("/api/admin/users", methods=['GET'])
def api_admin_get_users():
    """Get all users (admin only)"""
    if not _require_admin():
        return jsonify({'status': 'error', 'message': 'Admin access required'}), 403
    
    try:
        conn = get_db_connection()
        try:
            users = conn.execute('''
                SELECT id, email, mobile, email_verified, app_key, app_secret, 
                       is_admin, zerodha_access_token, zerodha_token_created_at
                FROM users
                ORDER BY id DESC
            ''').fetchall()
            
            users_list = []
            for user in users:
                users_list.append({
                    'id': user['id'],
                    'email': user['email'],
                    'mobile': user['mobile'],
                    'email_verified': bool(user['email_verified']),
                    'app_key': user['app_key'] if user['app_key'] else '',
                    'app_secret': user['app_secret'] if user['app_secret'] else '',
                    'is_admin': bool(user['is_admin']) if user['is_admin'] is not None else False,
                    'has_token': bool(user['zerodha_access_token']),
                    'token_created_at': user['zerodha_token_created_at']
                })
            return jsonify({'status': 'success', 'users': users_list}), 200
        finally:
            conn.close()
    except Exception as e:
        logging.error(f"Error fetching users: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route("/api/admin/users/<int:user_id>", methods=['PUT', 'DELETE', 'OPTIONS'])
def api_admin_manage_user(user_id):
    """Update or delete a user (admin only)"""
    if request.method == 'OPTIONS':
        # Handle CORS preflight
        return '', 200
    
    if not _require_admin():
        return jsonify({'status': 'error', 'message': 'Admin access required'}), 403
    
    if request.method == 'DELETE':
        # Delete user
        try:
            conn = get_db_connection()
            try:
                # Check if user exists
                user = conn.execute('SELECT id FROM users WHERE id = ?', (user_id,)).fetchone()
                if not user:
                    return jsonify({'status': 'error', 'message': 'User not found'}), 404
                
                # Prevent deleting yourself
                if user_id == session.get('user_id'):
                    return jsonify({'status': 'error', 'message': 'Cannot delete your own account'}), 400
                
                conn.execute('DELETE FROM users WHERE id = ?', (user_id,))
                conn.commit()
                return jsonify({'status': 'success', 'message': 'User deleted successfully'}), 200
            finally:
                conn.close()
        except Exception as e:
            logging.error(f"Error deleting user: {e}")
            return jsonify({'status': 'error', 'message': str(e)}), 500
    
    elif request.method == 'PUT':
        # Update user
        try:
            data = request.get_json()
            if not data:
                return jsonify({'status': 'error', 'message': 'No data provided'}), 400
            
            conn = get_db_connection()
            try:
                # Check if user exists
                user = conn.execute('SELECT id FROM users WHERE id = ?', (user_id,)).fetchone()
                if not user:
                    return jsonify({'status': 'error', 'message': 'User not found'}), 404
                
                updates = []
                values = []
                
                # Update is_admin
                if 'is_admin' in data:
                    is_admin = bool(data['is_admin'])
                    updates.append('is_admin = ?')
                    values.append(1 if is_admin else 0)
                
                # Update email_verified (for inactive/active)
                if 'email_verified' in data:
                    email_verified = bool(data['email_verified'])
                    updates.append('email_verified = ?')
                    values.append(1 if email_verified else 0)
                
                if not updates:
                    return jsonify({'status': 'error', 'message': 'No valid fields to update'}), 400
                
                values.append(user_id)
                query = f"UPDATE users SET {', '.join(updates)} WHERE id = ?"
                conn.execute(query, values)
                conn.commit()
                
                return jsonify({'status': 'success', 'message': 'User updated successfully'}), 200
            finally:
                conn.close()
        except Exception as e:
            logging.error(f"Error updating user: {e}")
            return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route("/api/admin/strategies/pending", methods=['GET'])
def api_admin_get_pending_strategies():
    """Get all strategies pending approval (admin only)"""
    if not _require_admin():
        return jsonify({'status': 'error', 'message': 'Admin access required'}), 403
    
    try:
        conn = get_db_connection()
        try:
            strategies = conn.execute('''
                SELECT s.*, u.email as user_email, u.mobile as user_mobile
                FROM strategies s
                JOIN users u ON s.user_id = u.id
                WHERE s.approval_status = 'pending'
                ORDER BY s.submitted_for_approval_at DESC
            ''').fetchall()
            
            strategies_list = []
            for strategy in strategies:
                strategy_dict = dict(strategy)
                strategies_list.append({
                    'id': strategy_dict.get('id'),
                    'strategy_name': strategy_dict.get('strategy_name', ''),
                    'strategy_type': strategy_dict.get('strategy_type', ''),
                    'instrument': strategy_dict.get('instrument', ''),
                    'user_id': strategy_dict.get('user_id'),
                    'user_email': strategy_dict.get('user_email', ''),
                    'user_mobile': strategy_dict.get('user_mobile', ''),
                    'created_at': strategy_dict.get('created_at', ''),
                    'submitted_for_approval_at': strategy_dict.get('submitted_for_approval_at', ''),
                    'approval_status': strategy_dict.get('approval_status', 'pending')
                })
            return jsonify({'status': 'success', 'strategies': strategies_list}), 200
        finally:
            conn.close()
    except Exception as e:
        logging.error(f"Error fetching pending strategies: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route("/api/admin/strategies/<int:strategy_id>/approve", methods=['POST'])
def api_admin_approve_strategy(strategy_id):
    """Approve a strategy (admin only)"""
    if not _require_admin():
        return jsonify({'status': 'error', 'message': 'Admin access required'}), 403
    
    try:
        conn = get_db_connection()
        try:
            strategy = conn.execute(
                'SELECT id, approval_status FROM strategies WHERE id = ?', 
                (strategy_id,)
            ).fetchone()
            
            if not strategy:
                return jsonify({'status': 'error', 'message': 'Strategy not found'}), 404
            
            if strategy['approval_status'] != 'pending':
                return jsonify({
                    'status': 'error', 
                    'message': f'Can only approve pending strategies. Current status: {strategy["approval_status"]}'
                }), 400
            
            admin_id = session.get('user_id')
            conn.execute(
                '''UPDATE strategies SET approval_status = 'approved', 
                   approved_at = CURRENT_TIMESTAMP, approved_by = ?
                   WHERE id = ?''',
                (admin_id, strategy_id)
            )
            conn.commit()
            return jsonify({'status': 'success', 'message': 'Strategy approved successfully'}), 200
        finally:
            conn.close()
    except Exception as e:
        logging.error(f"Error approving strategy: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route("/api/admin/strategies/<int:strategy_id>/reject", methods=['POST'])
def api_admin_reject_strategy(strategy_id):
    """Reject a strategy (admin only)"""
    if not _require_admin():
        return jsonify({'status': 'error', 'message': 'Admin access required'}), 403
    
    try:
        data = request.get_json() or {}
        rejection_reason = data.get('rejection_reason', '').strip()
        
        conn = get_db_connection()
        try:
            strategy = conn.execute(
                'SELECT id, approval_status FROM strategies WHERE id = ?', 
                (strategy_id,)
            ).fetchone()
            
            if not strategy:
                return jsonify({'status': 'error', 'message': 'Strategy not found'}), 404
            
            if strategy['approval_status'] != 'pending':
                return jsonify({
                    'status': 'error', 
                    'message': f'Can only reject pending strategies. Current status: {strategy["approval_status"]}'
                }), 400
            
            admin_id = session.get('user_id')
            conn.execute(
                '''UPDATE strategies SET approval_status = 'rejected', 
                   rejected_at = CURRENT_TIMESTAMP, rejected_by = ?, rejection_reason = ?
                   WHERE id = ?''',
                (admin_id, rejection_reason if rejection_reason else None, strategy_id)
            )
            conn.commit()
            return jsonify({'status': 'success', 'message': 'Strategy rejected successfully'}), 200
        finally:
            conn.close()
    except Exception as e:
        logging.error(f"Error rejecting strategy: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route("/api/user-data")
def api_user_data():
    if 'user_id' not in session:
        return jsonify({
            'status': 'error', 
            'message': 'User not logged in',
            'authenticated': False,
            'user_id': None
        }), 401
    
    try:
        user_id = session['user_id']
        user_row = _get_user_record(user_id)
        if not user_row:
            return jsonify({
                'status': 'error',
                'authenticated': False,
                'user_id': None,
                'message': 'User record not found'
            }), 400

        user = dict(user_row)
        app_key = user.get('app_key')
        stored_token = user.get('zerodha_access_token')
        session_token = session.get('access_token')

        default_response = {
            'status': 'success',
            'authenticated': True,
            'user_id': user_id,
            'user_name': 'Guest',
            'balance': 0,
            'access_token_present': False,
            'token_valid': False,
            'zerodha_credentials_present': bool(app_key),
            'kite_client_id': None  # Will be populated if token is valid
        }

        tokens_to_try: List[str] = []
        if session_token:
            tokens_to_try.append(session_token)
        if stored_token and stored_token not in tokens_to_try:
            tokens_to_try.append(stored_token)

        if app_key:
            for token in tokens_to_try:
                if not token:
                    continue
                try:
                    profile, margins = _validate_kite_token(app_key, token)
                    session['access_token'] = token
                    if stored_token != token:
                        _update_user_access_token(user_id, token)
                        stored_token = token

                    user_name = profile.get("user_name", "Guest")
                    balance = margins.get("equity", {}).get("available", {}).get("live_balance", 0)
                    
                    # Get Zerodha Kite Client ID (user_id from profile, e.g., "RD2033")
                    kite_client_id = profile.get("user_id") or profile.get("client_id") or None
                    
                    default_response.update({
                        'user_name': user_name,
                        'balance': balance,
                        'access_token_present': True,
                        'token_valid': True,
                        'kite_client_id': kite_client_id,
                        'message': 'Zerodha session active'
                    })
                    return jsonify(default_response)
                except kite_exceptions.TokenException as exc:
                    logging.warning("Zerodha token invalid for user %s: %s", user_id, exc)
                    if token == session_token:
                        session.pop('access_token', None)
                        session_token = None
                    if token == stored_token:
                        _update_user_access_token(user_id, None)
                        stored_token = None
                    continue
                except Exception as exc:
                    logging.error("Error validating Zerodha token for user %s: %s", user_id, exc)
                    if "Invalid `api_key` or `access_token`" in str(exc) or "Incorrect `api_key` or `access_token`" in str(exc):
                        if token == session_token:
                            session.pop('access_token', None)
                            session_token = None
                        if token == stored_token:
                            _update_user_access_token(user_id, None)
                            stored_token = None
                        continue
                    default_response['message'] = 'Error validating Zerodha session'
                    return jsonify(default_response), 500
        else:
            default_response['message'] = 'Zerodha credentials not configured'
            return jsonify(default_response)

        if stored_token:
            _update_user_access_token(user_id, None)

        default_response['message'] = 'Zerodha session expired'
        return jsonify(default_response)
    except Exception as e:
        logging.error(f"Error fetching user data: {e}")
        return jsonify({
            'status': 'error',
            'authenticated': True,
            'user_id': session.get('user_id'),
            'user_name': 'Guest',
            'balance': 0,
            'access_token_present': False,
            'token_valid': False,
            'message': 'Unexpected error while retrieving user data'
        }), 500

def _insert_contact_message(name: str, email: str, mobile: str, message: str, user_id: Optional[int] = None) -> None:
    conn = get_db_connection()
    conn.execute(
        'INSERT INTO user_contact_messages (user_id, name, email, mobile, message) VALUES (?, ?, ?, ?, ?)',
        (user_id, name, email, mobile, message)
    )
    conn.commit()
    conn.close()


@app.route("/api/contact", methods=['POST'])
def api_contact():
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    email = (data.get('email') or '').strip()
    mobile = (data.get('mobile') or '').strip()
    message = (data.get('message') or '').strip()

    if not all([name, email, mobile, message]):
        return jsonify({'status': 'error', 'message': 'All fields are required.'}), 400

    try:
        conn = get_db_connection()
        user = conn.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()
        user_id = user['id'] if user else None
        _insert_contact_message(name, email, mobile, message, user_id)
        send_support_email(name, email, mobile, message)
        return jsonify({'status': 'success', 'message': 'Thank you! Our team will get back to you soon.'})
    except Exception as exc:
        logging.error("Failed to process contact message: %s", exc, exc_info=True)
        return jsonify({'status': 'error', 'message': 'Unable to send message at the moment. Please try again later.'}), 500
    finally:
        conn.close()


@app.route("/api/user-credentials", methods=['GET', 'POST'])
def api_user_credentials():
    if 'user_id' not in session:
        return jsonify({'status': 'error', 'message': 'User not logged in'}), 401

    user_id = session['user_id']
    conn = get_db_connection()

    if request.method == 'GET':
        try:
            row = conn.execute(
                'SELECT app_key, app_secret FROM users WHERE id = ?',
                (user_id,)
            ).fetchone()
            conn.close()
            has_credentials = bool(row and row['app_key'] and row['app_secret'])
            return jsonify({'status': 'success', 'has_credentials': has_credentials})
        except Exception as exc:
            conn.close()
            logging.error("Failed to fetch user credentials state: %s", exc, exc_info=True)
            return jsonify({'status': 'error', 'message': 'Unable to fetch credentials state'}), 500

    try:
        payload = request.get_json(silent=True) or {}
        app_key = (payload.get('app_key') or '').strip()
        app_secret = (payload.get('app_secret') or '').strip()
        if not app_key or not app_secret:
            conn.close()
            return jsonify({'status': 'error', 'message': 'API key and secret are required'}), 400

        conn.execute(
            'UPDATE users SET app_key = ?, app_secret = ? WHERE id = ?',
            (app_key, app_secret, user_id)
        )
        conn.commit()
        conn.close()
        return jsonify({'status': 'success', 'message': 'Zerodha credentials saved successfully.'})
    except sqlite3.IntegrityError as db_err:
        conn.rollback()
        conn.close()
        logging.error("Database error while saving credentials: %s", db_err, exc_info=True)
        return jsonify({'status': 'error', 'message': 'Failed to save credentials. Please try again.'}), 500
    except Exception as exc:
        conn.rollback()
        conn.close()
        logging.error("Unexpected error while saving credentials: %s", exc, exc_info=True)
        return jsonify({'status': 'error', 'message': 'Unexpected error occurred.'}), 500

@app.route("/strategy/save", methods=['POST'])
@app.route("/api/strategy/save", methods=['POST'])
def save_strategy():
    if 'user_id' not in session:
        return jsonify({'status': 'error', 'message': 'User not logged in'}), 401

    user_id = session['user_id']
    
    # Handle both JSON and form data
    if request.is_json:
        data = request.get_json()
        strategy_id_raw = data.get('strategy_id')
        # Convert to int if it's a string or number, None if null/empty
        strategy_id = None
        if strategy_id_raw is not None and strategy_id_raw != '':
            try:
                strategy_id = int(strategy_id_raw)
            except (ValueError, TypeError):
                strategy_id = None
        strategy_name_input = data.get('strategy-name') or data.get('strategy_name')
        strategy_type = data.get('strategy') or data.get('strategy_type')
        instrument = data.get('instrument')
        candle_time = data.get('candle-time') or data.get('candle_time')
        execution_start = data.get('execution-start') or data.get('execution_start')
        execution_end = data.get('execution-end') or data.get('execution_end')
        stop_loss = data.get('stop-loss') or data.get('stop_loss')
        target_profit = data.get('target-profit') or data.get('target_profit')
        total_lot = data.get('total-lot') or data.get('total_lot')
        trailing_stop_loss = data.get('trailing-stop-loss') or data.get('trailing_stop_loss')
        segment = data.get('segment')
        trade_type = data.get('trade-type') or data.get('trade_type')
        strike_price = data.get('strike-price') or data.get('strike_price')
        expiry_type = data.get('expiry-type') or data.get('expiry_type')
        ema_period = data.get('ema-period') or data.get('ema_period')
        visibility = data.get('visibility')
        blueprint = data.get('blueprint')
        # Enhanced strategy data (stored as JSON strings)
        indicators = data.get('indicators', [])
        entry_rules = data.get('entry_rules', [])
        exit_rules = data.get('exit_rules', [])
        
        import json
        indicators_json = json.dumps(indicators) if indicators else None
        entry_rules_json = json.dumps(entry_rules) if entry_rules else None
        exit_rules_json = json.dumps(exit_rules) if exit_rules else None
    else:
        strategy_id = request.form.get('strategy_id')
        strategy_name_input = request.form.get('strategy-name')
        strategy_type = request.form.get('strategy')
        instrument = request.form.get('instrument')
        candle_time = request.form.get('candle-time')
        execution_start = request.form.get('execution-start')
        execution_end = request.form.get('execution-end')
        stop_loss = request.form.get('stop-loss')
        target_profit = request.form.get('target-profit')
        total_lot = request.form.get('total-lot')
        trailing_stop_loss = request.form.get('trailing-stop-loss')
        segment = request.form.get('segment')
        trade_type = request.form.get('trade-type')
        strike_price = request.form.get('strike-price')
        expiry_type = request.form.get('expiry-type')
        ema_period = request.form.get('ema-period')
        visibility = request.form.get('visibility')
        blueprint = request.form.get('blueprint')

    conn = get_db_connection()
    try:
        import json
        
        # Prepare JSON data
        indicators_json = None
        entry_rules_json = None
        exit_rules_json = None
        
        if request.is_json:
            indicators = data.get('indicators', [])
            entry_rules = data.get('entry_rules', [])
            exit_rules = data.get('exit_rules', [])
            indicators_json = json.dumps(indicators) if indicators else None
            entry_rules_json = json.dumps(entry_rules) if entry_rules else None
            exit_rules_json = json.dumps(exit_rules) if exit_rules else None
        else:
            indicators_raw = request.form.get('indicators')
            entry_rules_raw = request.form.get('entry_rules')
            exit_rules_raw = request.form.get('exit_rules')
            if indicators_raw:
                indicators_json = indicators_raw
            if entry_rules_raw:
                entry_rules_json = entry_rules_raw
            if exit_rules_raw:
                exit_rules_json = exit_rules_raw

        visibility_value = (visibility or 'private').strip().lower()
        if visibility_value not in ('private', 'public'):
            visibility_value = 'private'

        blueprint_text = None
        if blueprint is not None:
            blueprint_text = blueprint.strip() if isinstance(blueprint, str) else str(blueprint)
            if blueprint_text == '':
                blueprint_text = None
        
        # Validate required fields
        if not strategy_name_input or not strategy_name_input.strip():
            conn.close()
            return jsonify({'status': 'error', 'message': 'Strategy name is required'}), 400
        
        if not strategy_type:
            strategy_type = 'custom'
        
        if not instrument:
            instrument = 'NIFTY'
        
        if not segment:
            segment = 'Option'
        
        if strategy_id:
            # Check if strategy exists and belongs to user
            try:
                existing = conn.execute('SELECT * FROM strategies WHERE id = ? AND user_id = ?', 
                                       (strategy_id, user_id)).fetchone()
                if not existing:
                    conn.close()
                    logging.error(f"Strategy {strategy_id} not found for user {user_id}")
                    return jsonify({'status': 'error', 'message': 'Strategy not found or access denied'}), 404
            except Exception as e:
                conn.close()
                logging.error(f"Error checking strategy {strategy_id}: {e}")
                return jsonify({'status': 'error', 'message': f'Error validating strategy: {str(e)}'}), 500
            
            # Allow editing for any status, but reset approval status to draft when edited
            # Convert Row to dict for safe access
            existing_dict = dict(existing) if existing else {}
            current_status = existing_dict.get('approval_status') or 'draft'
            # Determine if only visibility has changed (keep approval status if approved)
            def _norm(val):
                if val is None:
                    return None
                return str(val).strip() if isinstance(val, str) else val
            only_visibility_change = (
                _norm(existing_dict.get('strategy_name')) == _norm(strategy_name_input) and
                _norm(existing_dict.get('strategy_type')) == _norm(strategy_type) and
                _norm(existing_dict.get('instrument')) == _norm(instrument) and
                _norm(existing_dict.get('candle_time')) == _norm(candle_time) and
                _norm(existing_dict.get('start_time')) == _norm(execution_start) and
                _norm(existing_dict.get('end_time')) == _norm(execution_end) and
                _norm(existing_dict.get('stop_loss')) == _norm(stop_loss) and
                _norm(existing_dict.get('target_profit')) == _norm(target_profit) and
                _norm(existing_dict.get('total_lot')) == _norm(total_lot) and
                _norm(existing_dict.get('trailing_stop_loss')) == _norm(trailing_stop_loss) and
                _norm(existing_dict.get('segment')) == _norm(segment) and
                _norm(existing_dict.get('trade_type')) == _norm(trade_type) and
                _norm(existing_dict.get('strike_price')) == _norm(strike_price) and
                _norm(existing_dict.get('expiry_type')) == _norm(expiry_type) and
                _norm(existing_dict.get('ema_period')) == _norm(ema_period) and
                _norm(existing_dict.get('indicators')) == _norm(indicators_json) and
                _norm(existing_dict.get('entry_rules')) == _norm(entry_rules_json) and
                _norm(existing_dict.get('exit_rules')) == _norm(exit_rules_json) and
                _norm(existing_dict.get('blueprint')) == _norm(blueprint_text)
            )
            # When a strategy is edited, reset to draft unless only visibility changed on an approved strategy
            new_status = current_status
            if not only_visibility_change:
                new_status = 'draft'
            conn.execute(
                '''UPDATE strategies SET strategy_name = ?, strategy_type = ?, instrument = ?, candle_time = ?, 
                   start_time = ?, end_time = ?, stop_loss = ?, target_profit = ?, total_lot = ?, 
                   trailing_stop_loss = ?, segment = ?, trade_type = ?, strike_price = ?, expiry_type = ?, 
                   ema_period = ?, visibility = ?, indicators = ?, entry_rules = ?, exit_rules = ?, blueprint = ?, 
                   approval_status = ?, updated_at = CURRENT_TIMESTAMP 
                   WHERE id = ? AND user_id = ?''',
                (strategy_name_input, strategy_type, instrument, candle_time, execution_start, execution_end, 
                 stop_loss, target_profit, total_lot, trailing_stop_loss, segment, trade_type, strike_price, 
                 expiry_type, ema_period, visibility_value, indicators_json, entry_rules_json, exit_rules_json, 
                 blueprint_text, new_status, strategy_id, user_id)
            )
            message = 'Strategy updated successfully!'
        else:
            # Insert new strategy
            conn.execute(
                '''INSERT INTO strategies (user_id, strategy_name, strategy_type, instrument, candle_time, start_time, 
                   end_time, stop_loss, target_profit, total_lot, trailing_stop_loss, segment, trade_type, 
                   strike_price, expiry_type, ema_period, visibility, indicators, entry_rules, exit_rules, blueprint, approval_status) 
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')''',
                (user_id, strategy_name_input, strategy_type, instrument, candle_time, execution_start, 
                 execution_end, stop_loss, target_profit, total_lot, trailing_stop_loss, segment, trade_type, 
                 strike_price, expiry_type, ema_period, visibility_value, indicators_json, entry_rules_json, 
                 exit_rules_json, blueprint_text)
            )
            message = 'Strategy saved successfully!'
        conn.commit()
        return jsonify({'status': 'success', 'message': message})
    except Exception as e:
        conn.rollback()
        logging.error(f"Error saving strategy: {e}", exc_info=True)
        return jsonify({'status': 'error', 'message': f'Error saving strategy: {str(e)}'}), 500
    finally:
        conn.close()

@app.route("/strategy/edit/<int:strategy_id>", methods=['GET'])
def edit_strategy(strategy_id):
    if 'user_id' not in session:
        return jsonify({'status': 'error', 'message': 'User not logged in'}), 401

    conn = get_db_connection()
    strategy = conn.execute('SELECT * FROM strategies WHERE id = ? AND user_id = ?', (strategy_id, session['user_id'])).fetchone()
    conn.close()

    if strategy:
        return jsonify({'status': 'success', 'strategy': dict(strategy)})
    else:
        return jsonify({'status': 'error', 'message': 'Strategy not found'}), 404

@app.route("/api/strategy/<int:strategy_id>/submit-for-approval", methods=['POST'])
def submit_strategy_for_approval(strategy_id):
    """Submit strategy for admin approval"""
    if 'user_id' not in session:
        return jsonify({'status': 'error', 'message': 'User not logged in'}), 401
    
    user_id = session['user_id']
    conn = get_db_connection()
    try:
        strategy = conn.execute(
            'SELECT id, approval_status, user_id FROM strategies WHERE id = ?', 
            (strategy_id,)
        ).fetchone()
        
        if not strategy:
            return jsonify({'status': 'error', 'message': 'Strategy not found'}), 404
        
        if strategy['user_id'] != user_id:
            return jsonify({'status': 'error', 'message': 'Access denied'}), 403
        
        current_status = strategy['approval_status'] or 'draft'
        if current_status != 'draft':
            return jsonify({
                'status': 'error', 
                'message': f'Strategy must be in draft status. Current status: {current_status}'
            }), 400
        
        conn.execute(
            '''UPDATE strategies SET approval_status = 'pending', 
               submitted_for_approval_at = CURRENT_TIMESTAMP 
               WHERE id = ?''',
            (strategy_id,)
        )
        conn.commit()
        return jsonify({'status': 'success', 'message': 'Strategy submitted for approval'}), 200
    finally:
        conn.close()

@app.route("/api/strategy/<int:strategy_id>/revoke-approval", methods=['POST'])
def revoke_strategy_approval(strategy_id):
    """Revoke strategy from approval (back to draft) - works for both pending and approved"""
    if 'user_id' not in session:
        return jsonify({'status': 'error', 'message': 'User not logged in'}), 401
    
    user_id = session['user_id']
    conn = get_db_connection()
    try:
        strategy = conn.execute(
            'SELECT id, approval_status, user_id FROM strategies WHERE id = ?', 
            (strategy_id,)
        ).fetchone()
        
        if not strategy:
            return jsonify({'status': 'error', 'message': 'Strategy not found'}), 404
        
        if strategy['user_id'] != user_id:
            return jsonify({'status': 'error', 'message': 'Access denied'}), 403
        
        current_status = strategy['approval_status'] or 'draft'
        if current_status not in ('pending', 'approved'):
            return jsonify({
                'status': 'error', 
                'message': f'Can only revoke pending or approved strategies. Current status: {current_status}'
            }), 400
        
        # Reset to draft and clear approval-related fields
        conn.execute(
            '''UPDATE strategies SET approval_status = 'draft', 
               submitted_for_approval_at = NULL,
               approved_at = NULL, approved_by = NULL,
               rejected_at = NULL, rejected_by = NULL, rejection_reason = NULL
               WHERE id = ?''',
            (strategy_id,)
        )
        conn.commit()
        return jsonify({'status': 'success', 'message': 'Strategy approval revoked and reset to draft'}), 200
    finally:
        conn.close()

@app.route("/api/strategy/<int:strategy_id>/resubmit", methods=['POST'])
def resubmit_strategy(strategy_id):
    """Resubmit rejected strategy for approval"""
    if 'user_id' not in session:
        return jsonify({'status': 'error', 'message': 'User not logged in'}), 401
    
    user_id = session['user_id']
    conn = get_db_connection()
    try:
        strategy = conn.execute(
            'SELECT id, approval_status, user_id FROM strategies WHERE id = ?', 
            (strategy_id,)
        ).fetchone()
        
        if not strategy:
            return jsonify({'status': 'error', 'message': 'Strategy not found'}), 404
        
        if strategy['user_id'] != user_id:
            return jsonify({'status': 'error', 'message': 'Access denied'}), 403
        
        current_status = strategy['approval_status'] or 'draft'
        if current_status != 'rejected':
            return jsonify({
                'status': 'error', 
                'message': f'Can only resubmit rejected strategies. Current status: {current_status}'
            }), 400
        
        conn.execute(
            '''UPDATE strategies SET approval_status = 'pending', 
               submitted_for_approval_at = CURRENT_TIMESTAMP,
               rejected_at = NULL, rejected_by = NULL, rejection_reason = NULL
               WHERE id = ?''',
            (strategy_id,)
        )
        conn.commit()
        return jsonify({'status': 'success', 'message': 'Strategy resubmitted for approval'}), 200
    finally:
        conn.close()

@app.route("/strategy/delete/<int:strategy_id>", methods=['POST'])
@app.route("/api/strategy/delete/<int:strategy_id>", methods=['POST'])
def delete_strategy(strategy_id):
    if 'user_id' not in session:
        return jsonify({'status': 'error', 'message': 'User not logged in'}), 401

    # If strategy is running, stop it first
    unique_run_id_to_del = None
    for unique_run_id, running_strat_info in running_strategies.items():
        if running_strat_info.get('db_id') == strategy_id:
            unique_run_id_to_del = unique_run_id
            break
    
    if unique_run_id_to_del:
        del running_strategies[unique_run_id_to_del]

    conn = get_db_connection()
    try:
        # Check strategy exists and belongs to user
        strategy = conn.execute(
            'SELECT id, approval_status, user_id FROM strategies WHERE id = ?', 
            (strategy_id,)
        ).fetchone()
        
        if not strategy:
            return jsonify({'status': 'error', 'message': 'Strategy not found'}), 404
        
        if strategy['user_id'] != session['user_id']:
            return jsonify({'status': 'error', 'message': 'Access denied'}), 403
        
        # Only allow deletion if status is draft or rejected
        approval_status = strategy['approval_status'] or 'draft'
        if approval_status not in ('draft', 'rejected'):
            return jsonify({
                'status': 'error', 
                'message': f'Cannot delete strategy with status: {approval_status}. Please revoke approval first.'
            }), 400
        
        conn.execute('DELETE FROM strategies WHERE id = ? AND user_id = ?', (strategy_id, session['user_id']))
        conn.commit()
        return jsonify({'status': 'success', 'message': 'Strategy deleted successfully!'})
    except Exception as e:
        conn.rollback()
        logging.error(f"Error deleting strategy: {e}", exc_info=True)
        return jsonify({'status': 'error', 'message': f'Error deleting strategy: {e}'}), 500
    finally:
        conn.close()

@app.route("/strategy/deploy/<int:strategy_id>", methods=['POST', 'OPTIONS'])
@app.route("/api/strategy/deploy/<int:strategy_id>", methods=['POST', 'OPTIONS'])
def deploy_strategy(strategy_id):
    # Handle CORS preflight
    if request.method == 'OPTIONS':
        return jsonify({'status': 'ok'}), 200
    
    if 'user_id' not in session:
        return jsonify({'status': 'error', 'message': 'User not logged in'}), 401
    
    if 'access_token' not in session:
        return jsonify({'status': 'error', 'message': 'Zerodha not connected. Please connect your Zerodha account first.'}), 401

    conn = get_db_connection()
    strategy_data = conn.execute('SELECT * FROM strategies WHERE id = ? AND user_id = ?', (strategy_id, session['user_id'])).fetchone()
    conn.close()

    if not strategy_data:
        return jsonify({'status': 'error', 'message': 'Strategy not found'}), 404
    
    # Check if strategy is approved
    approval_status = strategy_data.get('approval_status') if strategy_data else None
    if approval_status != 'approved':
        return jsonify({
            'status': 'error', 
            'message': f'Strategy must be approved before deployment. Current status: {approval_status or "draft"}'
        }), 400

    # Handle both form and JSON requests - be lenient with parsing
    paper_trade = False
    try:
        if request.content_type and 'application/json' in request.content_type:
            # Try to parse JSON, but don't fail if it's empty or invalid
            data = request.get_json(silent=True, force=True)
            if data:
                paper_trade = data.get('paper_trade', False)
        elif request.form:
            paper_trade = request.form.get('paper_trade') == 'on'
    except Exception as e:
        logging.warning(f"Error parsing request data in deploy_strategy: {e}")
        paper_trade = False

    # Check if strategy is already running
    # Remove from running_strategies if it exists but is not actually running
    for unique_run_id, running_strat_info in list(running_strategies.items()):
        if running_strat_info['db_id'] == strategy_id:
            if running_strat_info['status'] == 'running' and strategy_data['status'] not in ['sq_off', 'paused']:
                return jsonify({'status': 'error', 'message': 'Strategy is already running'}), 400
            else:
                # Remove stale entries (paused, error, etc.) to allow redeployment
                del running_strategies[unique_run_id]
                logging.info(f"Removed stale strategy entry {unique_run_id} for strategy {strategy_id} before redeployment")

    # Access sqlite3.Row fields directly (they support dict-like access)
    try:
        strategy_type = strategy_data['strategy_type']
    except (KeyError, IndexError):
        strategy_type = None
    
    # Validate that strategy status allows deployment
    try:
        current_status = strategy_data['status']
    except (KeyError, IndexError):
        current_status = 'saved'
    if current_status not in ['saved', 'paused', 'error', 'sq_off']:
        if current_status == 'running':
            return jsonify({'status': 'error', 'message': 'Strategy is already running'}), 400
        else:
            return jsonify({'status': 'error', 'message': f'Cannot deploy strategy with status: {current_status}'}), 400

    # Validate strategy_type exists
    if not strategy_type:
        logging.error(f"Strategy {strategy_id} has no strategy_type")
        return jsonify({'status': 'error', 'message': 'Strategy type not found. Please edit and save the strategy first.'}), 400

    try:
        strategy_class = None
        if strategy_type == 'orb':
            strategy_class = ORB
        elif strategy_type == 'capture_mountain_signal':
            strategy_class = CaptureMountainSignal
        else:
            logging.error(f"Unknown strategy type: {strategy_type} for strategy {strategy_id}")
            return jsonify({'status': 'error', 'message': f'Unknown strategy type: {strategy_type}'}), 400

        # Instantiate the strategy with saved parameters
        strategy = strategy_class(
            kite,
            strategy_data['instrument'],
            strategy_data['candle_time'],
            strategy_data['start_time'],
            strategy_data['end_time'],
            strategy_data['stop_loss'],
            strategy_data['target_profit'],
            strategy_data['total_lot'],
            strategy_data['trailing_stop_loss'],
            strategy_data['segment'],
            strategy_data['trade_type'],
            strategy_data['strike_price'],
            strategy_data['expiry_type'],
            strategy_data['strategy_name'],
            paper_trade=paper_trade
        )
        strategy.run()

        # Store in-memory with a reference to the DB ID
        unique_run_id = str(uuid.uuid4())
        running_strategies[unique_run_id] = {
            'db_id': strategy_id,
            'name': strategy_data['strategy_name'],
            'instrument': strategy_data['instrument'],
            'status': 'running',
            'strategy_type': strategy_type, # Add strategy_type here
            'strategy': strategy, # Store the actual strategy object
            'user_id': session['user_id'] # Add user_id for WebSocket room management
        }

        # Update status in DB
        conn = get_db_connection()
        conn.execute('UPDATE strategies SET status = ? WHERE id = ?', ('running', strategy_id))
        conn.commit()
        conn.close()

        return jsonify({'status': 'success', 'message': 'Strategy deployed successfully!'})
    except Exception as e:
        logging.error(f"Error deploying strategy {strategy_id}: {e}", exc_info=True)
        try:
            conn = get_db_connection()
            conn.execute('UPDATE strategies SET status = ? WHERE id = ?', ('error', strategy_id))
            conn.commit()
            conn.close()
        except:
            pass
        return jsonify({'status': 'error', 'message': f'Error deploying strategy: {str(e)}'}), 500

@app.route("/strategy/pause/<int:strategy_id>", methods=['POST'])
@app.route("/api/strategy/pause/<int:strategy_id>", methods=['POST'])
def pause_strategy(strategy_id):
    if 'user_id' not in session:
        return jsonify({'status': 'error', 'message': 'User not logged in'}), 401

    # Find the running strategy by its db_id
    strategy_found_in_memory = False
    for unique_run_id, running_strat_info in running_strategies.items():
        if running_strat_info['db_id'] == strategy_id:
            strategy_found_in_memory = True
            # Here you would implement logic to actually pause the strategy
            # For now, we just change its in-memory status
            running_strat_info['status'] = 'paused'
            break
    
    # Update status in DB regardless of whether it's in memory or not
    conn = get_db_connection()
    try:
        # Check if strategy exists and belongs to user
        strategy_row = conn.execute(
            'SELECT status FROM strategies WHERE id = ? AND user_id = ?',
            (strategy_id, session['user_id'])
        ).fetchone()
        
        if strategy_row is None:
            conn.close()
            return jsonify({'status': 'error', 'message': 'Strategy not found'}), 404
        
        current_status = strategy_row['status']
        
        # Only allow pause if strategy is currently running
        if current_status != 'running':
            conn.close()
            return jsonify({
                'status': 'error', 
                'message': f'Strategy is not running. Current status: {current_status}'
            }), 400
        
        # Update status in DB to paused
        conn.execute('UPDATE strategies SET status = ? WHERE id = ?', ('paused', strategy_id))
        conn.commit()
        conn.close()
        return jsonify({'status': 'success', 'message': 'Strategy paused successfully!'})
    except Exception as e:
        conn.close()
        logging.error(f"Error pausing strategy {strategy_id}: {e}", exc_info=True)
        return jsonify({'status': 'error', 'message': f'Error pausing strategy: {str(e)}'}), 500

@app.route("/strategy/squareoff/<int:strategy_id>", methods=['POST'])
@app.route("/api/strategy/squareoff/<int:strategy_id>", methods=['POST'])
def squareoff_strategy(strategy_id):
    if 'user_id' not in session:
        return jsonify({'status': 'error', 'message': 'User not logged in'}), 401

    # Find the running strategy by its db_id in the in-memory dict and remove it
    unique_run_id_to_del = None
    for unique_run_id, running_strat_info in running_strategies.items():
        if running_strat_info['db_id'] == strategy_id:
            unique_run_id_to_del = unique_run_id
            break
    
    if unique_run_id_to_del:
        del running_strategies[unique_run_id_to_del]

    # Update status in DB
    conn = get_db_connection()
    conn.execute('UPDATE strategies SET status = ? WHERE id = ?', ('sq_off', strategy_id))
    conn.commit()
    conn.close()
    return jsonify({'status': 'success', 'message': 'Strategy squared off successfully!'})

@app.route("/strategies")
def get_strategies():
    # This needs to be made serializable
    strategies = {}
    for strategy_id, strategy_info in running_strategies.items():
        strategies[strategy_id] = {
            'name': strategy_info['name'],
            'instrument': strategy_info['instrument'],
            'status': strategy_info['status']
        }
    return jsonify(strategies)

@app.route("/api/strategies")
def api_get_strategies():
    if 'user_id' not in session:
        return jsonify({'status': 'error', 'message': 'User not logged in'}), 401

    conn = get_db_connection()
    user_id = session['user_id']
    
    # Get filter parameter
    approval_filter = request.args.get('approval_status')
    only_approved = request.args.get('only_approved', 'false').lower() == 'true'
    
    # Build query
    query = '''
        SELECT 
            s.*,
            CASE WHEN s.user_id = ? THEN 1 ELSE 0 END AS can_edit
        FROM strategies s
        WHERE (s.user_id = ? OR s.visibility = 'public')
    '''
    params = [user_id, user_id]
    
    # Add approval status filter
    if only_approved:
        query += " AND (s.approval_status = 'approved' OR s.approval_status IS NULL)"
    elif approval_filter:
        query += " AND s.approval_status = ?"
        params.append(approval_filter)
    
    query += " ORDER BY can_edit DESC, datetime(s.updated_at) DESC"
    
    strategies = conn.execute(query, params).fetchall()
    conn.close()

    # Convert Row objects to dictionaries for JSON serialization
    strategies_list = []
    for row in strategies:
        strategy_dict = dict(row)
        strategy_dict['can_edit'] = bool(strategy_dict.get('can_edit', 0))
        strategies_list.append(strategy_dict)

    return jsonify({'status': 'success', 'strategies': strategies_list})


@app.route("/api/ai/strategy_chat", methods=['POST'])
def api_ai_strategy_chat():
    if 'user_id' not in session:
        return jsonify({'status': 'error', 'message': 'User not logged in'}), 401

    payload = request.get_json(silent=True) or {}
    message = (payload.get('message') or '').strip()
    if not message:
        return jsonify({'status': 'error', 'message': 'Message is required to generate a strategy'}), 400

    history = payload.get('history') or []
    if not isinstance(history, list):
        history = []

    sanitized_history: List[Dict[str, str]] = []
    for item in history[-10:]:
        role = item.get('role')
        content = (item.get('content') or '').strip()
        if role in ('user', 'assistant') and content:
            sanitized_history.append({'role': role, 'content': content})

    try:
        strategy_text = create_trading_strategy_from_chat(message, sanitized_history)
        validation = validate_strategy_format(strategy_text)
    except Exception as exc:
        logging.error("AI strategy generation failed: %s", exc, exc_info=True)
        return jsonify({'status': 'error', 'message': str(exc)}), 500

    response_payload: Dict[str, Any] = {
        'status': 'success',
        'strategy': strategy_text,
        'validation': validation,
    }

    if payload.get('auto_save'):
        try:
            saved_path = save_strategy_to_file(strategy_text, session.get('user_id'))
            response_payload['savedPath'] = saved_path
        except Exception as save_exc:
            logging.error("Auto-save failed for AI strategy: %s", save_exc, exc_info=True)

    return jsonify(response_payload)


@app.route("/api/ai/strategy_chat/save", methods=['POST'])
def api_ai_strategy_chat_save():
    if 'user_id' not in session:
        return jsonify({'status': 'error', 'message': 'User not logged in'}), 401

    payload = request.get_json(silent=True) or {}
    strategy_text = (payload.get('strategy_text') or '').strip()
    if not strategy_text:
        return jsonify({'status': 'error', 'message': 'strategy_text is required'}), 400

    try:
        saved_path = save_strategy_to_file(strategy_text, session.get('user_id'))
        validation = validate_strategy_format(strategy_text)
    except Exception as exc:
        logging.error("Failed to save AI strategy output: %s", exc, exc_info=True)
        return jsonify({'status': 'error', 'message': str(exc)}), 500

    return jsonify({
        'status': 'success',
        'savedPath': saved_path,
        'validation': validation,
    })


@app.route("/api/running-strategies")
def api_get_running_strategies():
    """Get currently running strategies"""
    if 'user_id' not in session:
        return jsonify({'status': 'error', 'message': 'User not logged in'}), 401

    # Get running strategies from database
    conn = get_db_connection()
    running_strategies = conn.execute(
        'SELECT * FROM strategies WHERE user_id = ? AND status = ?', 
        (session['user_id'], 'running')
    ).fetchall()
    conn.close()

    # Convert to list of dictionaries
    strategies_list = [dict(s) for s in running_strategies]
    return jsonify({'status': 'success', 'strategies': strategies_list})

@app.route("/strategy/cancel/<strategy_id>")
def cancel_strategy(strategy_id):
    if strategy_id in running_strategies:
        del running_strategies[strategy_id]
    return redirect("/dashboard")

@app.route("/api/backtest_mountain_signal", methods=['POST'])
def api_backtest_mountain_signal():
    """Backtest Mountain Signal strategy for a date range"""
    if 'user_id' not in session:
        return jsonify({'status': 'error', 'message': 'User not logged in'}), 401

    try:
        data = request.get_json()
        from_date_str = data.get('from_date')
        to_date_str = data.get('to_date')
        instrument = data.get('instrument', 'BANKNIFTY')
        candle_time = data.get('candle_time', '5')
        ema_period = data.get('ema_period', 5)

        if not from_date_str or not to_date_str:
            return jsonify({'status': 'error', 'message': 'From date and to date are required'}), 400

        from_date = datetime.datetime.strptime(from_date_str, '%Y-%m-%d').date()
        to_date = datetime.datetime.strptime(to_date_str, '%Y-%m-%d').date()

        try:
            rules_data = load_mountain_signal_pe_rules()
        except Exception as rules_error:
            logging.error(f"Failed to load Mountain Signal PE rules for backtest: {rules_error}", exc_info=True)
            rules_data = {
                'option_trade': {
                    'stop_loss_percent': -0.17,
                    'target_percent': 0.45
                },
                'lot_sizes': {
                    'BANKNIFTY': 35,
                    'NIFTY': 75
                },
                'strike_rounding': {
                    'BANKNIFTY': 100,
                    'NIFTY': 50
                },
                'expiry_policy': {
                    'BANKNIFTY': 'monthly',
                    'NIFTY': 'weekly'
                },
                'evaluation': {
                    'seconds_before_close': 20
                },
                'exit_priority': ['option_stop_loss', 'option_target', 'market_close 15:15', 'index_stop', 'index_target']
            }

        instrument_key = 'BANKNIFTY' if 'BANK' in instrument.upper() else 'NIFTY'

        strike_rounding_map = {
            key.upper(): int(value)
            for key, value in (rules_data.get('strike_rounding') or {}).items()
            if value is not None
        }
        lot_sizes_map = {
            key.upper(): int(value)
            for key, value in (rules_data.get('lot_sizes') or {}).items()
            if value is not None
        }
        stop_loss_percent = rules_data.get('option_trade', {}).get('stop_loss_percent', -0.17)
        target_percent = rules_data.get('option_trade', {}).get('target_percent', 0.45)
        signals_config = rules_data.get('signals') or {}
        pe_signal_config = signals_config.get('PE') or signals_config.get('pe') or {}
        rsi_threshold = float(pe_signal_config.get('rsi_threshold', 70))

        strike_step_default = 100 if instrument_key == 'BANKNIFTY' else 50
        lot_size_default = 35 if instrument_key == 'BANKNIFTY' else 75

        strike_step = strike_rounding_map.get(instrument_key, strike_step_default)
        lot_size_value = lot_sizes_map.get(instrument_key, lot_size_default)

        # Validate date range (max 30 days)
        days_diff = (to_date - from_date).days
        if days_diff > 30:
            return jsonify({'status': 'error', 'message': 'Maximum 30 days allowed'}), 400

        # Resolve instrument token
        if instrument.upper() == 'NIFTY':
            token = 256265
        elif instrument.upper() == 'BANKNIFTY':
            token = 260105
        else:
            return jsonify({'status': 'error', 'message': 'Invalid instrument'}), 400

        # Fetch historical data for all dates in range using user's Kite client
        user_id = session['user_id']
        
        def _fetch_historical_data(kite_client):
            all_candles = []
            current_date = from_date
            kite_interval = f"{candle_time}minute"

            while current_date <= to_date:
                # Skip weekends
                if current_date.weekday() < 5:  # Monday=0, Friday=4
                    start_dt = datetime.datetime.combine(current_date, datetime.time(9, 15))
                    end_dt = datetime.datetime.combine(current_date, datetime.time(15, 30))
                
                    try:
                        # Capture loop variables for lambda using default parameters
                        hist = execute_with_retries(
                            f"fetching {kite_interval} historical data for token {token} on {current_date}",
                            lambda t=token, sd=start_dt, ed=end_dt, ki=kite_interval: kite_client.historical_data(t, sd, ed, ki)
                        )
                        if hist:
                            all_candles.extend(hist)
                    except kite_exceptions.TokenException:
                        raise
                    except Exception as e:
                        logging.error(f"Error fetching historical data for {current_date}: {e}")
                
                current_date += datetime.timedelta(days=1)
            
            return all_candles
        
        try:
            all_candles = _with_valid_kite_client(
                user_id,
                f"backtest mountain signal for {instrument}",
                _fetch_historical_data
            )
        except kite_exceptions.TokenException:
            return jsonify({
                'status': 'error',
                'message': 'Zerodha session expired. Please log in again.',
                'authExpired': True
            }), 401
        except RuntimeError as err:
            logging.error(f"Error preparing Zerodha session for backtest: {err}")
            return jsonify({
                'status': 'error',
                'message': str(err)
            }), 400

        if not all_candles:
            return jsonify({'status': 'error', 'message': 'No historical data found for the selected date range'}), 404

        # Sort candles by date
        all_candles.sort(key=lambda x: x['date'])

        # Run Mountain Signal strategy logic on historical data
        from utils.indicators import calculate_rsi
        import pandas as pd
        import numpy as np

        # Convert to DataFrame
        df_data = []
        for candle in all_candles:
            df_data.append({
                'date': candle['date'],
                'open': candle['open'],
                'high': candle['high'],
                'low': candle['low'],
                'close': candle['close']
            })
        
        df = pd.DataFrame(df_data)
        df['ema'] = df['close'].ewm(span=ema_period, adjust=False).mean()
        
        # Calculate RSI 14
        if len(df) >= 15:
            df['rsi14'] = calculate_rsi(df['close'], period=14)
        else:
            df['rsi14'] = None

        # Initialize strategy state
        pe_signal_candle = None
        ce_signal_candle = None
        trade_placed = False
        position = 0  # 0: flat, 1: long (CE), -1: short (PE)
        entry_price = 0
        exit_price = 0
        trades = []
        option_trades = []
        active_option_trade = None
        option_trade_sequence = 0
        pe_signal_price_above_low = False
        ce_signal_price_below_high = False
        signal_candles_with_entry = set()
        consecutive_candles_for_target = 0
        last_candle_high_less_than_ema = False
        last_candle_low_greater_than_ema = False
        # Store signal candle info in active trade for exit logic
        active_trade_signal_candle = None

        # Process each candle
        for i in range(1, len(df)):
            current_candle = df.iloc[i]
            previous_candle = df.iloc[i-1]
            current_ema = current_candle['ema']
            previous_ema = previous_candle['ema']
            previous_rsi = df.iloc[i-1]['rsi14'] if 'rsi14' in df.columns else None

            # Signal Identification (using previous candle)
            # PE Signal: LOW > 5 EMA AND RSI exceeds threshold
            if previous_candle['low'] > previous_ema:
                if previous_rsi is not None and previous_rsi > rsi_threshold:
                    if pe_signal_candle is not None:
                        pe_signal_price_above_low = False
                        if 'index' in pe_signal_candle:
                            signal_candles_with_entry.discard(pe_signal_candle['index'])
                    pe_signal_candle = {
                        'date': previous_candle['date'],
                        'high': previous_candle['high'],
                        'low': previous_candle['low'],
                        'index': i - 1
                    }
                    ce_signal_candle = None

            # CE Signal: HIGH < 5 EMA AND RSI < 30
            if previous_candle['high'] < previous_ema:
                if previous_rsi is not None and previous_rsi < 30:
                    if ce_signal_candle is not None:
                        ce_signal_price_below_high = False
                        if 'index' in ce_signal_candle:
                            signal_candles_with_entry.discard(ce_signal_candle['index'])
                    ce_signal_candle = {
                        'date': previous_candle['date'],
                        'high': previous_candle['high'],
                        'low': previous_candle['low'],
                        'index': i - 1
                    }
                    pe_signal_candle = None

            # Price action validation for re-entry
            if pe_signal_candle is not None and not trade_placed and not pe_signal_price_above_low:
                if current_candle['high'] > pe_signal_candle['low']:
                    pe_signal_price_above_low = True

            if ce_signal_candle is not None and not trade_placed and not ce_signal_price_below_high:
                if current_candle['low'] < ce_signal_candle['high']:
                    ce_signal_price_below_high = True

            # Entry Logic
            if not trade_placed:
                # PE Entry
                if pe_signal_candle is not None and current_candle['close'] < pe_signal_candle['low']:
                    signal_candle_index = pe_signal_candle['index']
                    is_first_entry = signal_candle_index not in signal_candles_with_entry
                    entry_allowed = is_first_entry or pe_signal_price_above_low
                    
                    if entry_allowed:
                        trade_placed = True
                        position = -1  # PE (short)
                        entry_price = current_candle['close']
                        signal_candles_with_entry.add(signal_candle_index)
                        pe_signal_price_above_low = False
                        # Store signal candle info for exit logic
                        active_trade_signal_candle = {
                            'high': pe_signal_candle['high'],
                            'low': pe_signal_candle['low'],
                            'type': 'PE'
                        }
                        trades.append({
                            'signal_time': pe_signal_candle['date'],
                            'signal_type': 'PE',
                            'signal_high': pe_signal_candle['high'],
                            'signal_low': pe_signal_candle['low'],
                            'entry_time': current_candle['date'],
                            'entry_price': entry_price,
                            'exit_time': None,
                            'exit_price': None,
                            'exit_type': None,
                            'pnl': None,
                            'pnl_percent': None,
                            'date': current_candle['date'].date() if isinstance(current_candle['date'], datetime.datetime) else current_candle['date'],
                            'lot_size': lot_size_value,
                            'option_trade_id': None,
                            'option_symbol': None,
                            'option_entry_price': None,
                            'stop_loss_price': None,
                            'target_price': None,
                            'option_exit_price': None
                        })
                        consecutive_candles_for_target = 0
                        last_candle_high_less_than_ema = False

                        trade_index = len(trades) - 1
                        trade_date_value = trades[trade_index]['date']
                        atm_strike = round_to_atm_price(entry_price, strike_step)
                        option_symbol = get_option_symbol_from_components(instrument_key, atm_strike, 'PE', current_candle['date'])
                        option_entry_price = simulate_option_premium(entry_price, atm_strike, 'PE')
                        stop_loss_price_abs = round(option_entry_price * (1 + stop_loss_percent), 2)
                        target_price_abs = round(option_entry_price * (1 + target_percent), 2)

                        option_trade = {
                            'id': option_trade_sequence,
                            'index_trade_index': trade_index,
                            'signal_time': pe_signal_candle['date'],
                            'signal_type': 'PE',
                            'signal_high': float(pe_signal_candle['high']),
                            'signal_low': float(pe_signal_candle['low']),
                            'entry_time': current_candle['date'],
                            'index_at_entry': float(entry_price),
                            'atm_strike': float(atm_strike),
                            'option_symbol': option_symbol,
                            'option_entry_price': float(option_entry_price),
                            'stop_loss_price': float(stop_loss_price_abs),
                            'target_price': float(target_price_abs),
                            'option_exit_price': None,
                            'exit_time': None,
                            'exit_type': None,
                            'pnl': None,
                            'pnl_percent': None,
                            'status': 'open',
                            'lot_size': lot_size_value,
                            'date': trade_date_value
                        }
                        option_trades.append(option_trade)
                        option_trade_sequence += 1
                        trades[trade_index]['option_trade_id'] = option_trade['id']
                        trades[trade_index]['option_symbol'] = option_symbol
                        trades[trade_index]['option_entry_price'] = float(option_entry_price)
                        trades[trade_index]['stop_loss_price'] = float(stop_loss_price_abs)
                        trades[trade_index]['target_price'] = float(target_price_abs)
                        active_option_trade = option_trade

                # CE Entry
                elif ce_signal_candle is not None and current_candle['close'] > ce_signal_candle['high']:
                    signal_candle_index = ce_signal_candle['index']
                    is_first_entry = signal_candle_index not in signal_candles_with_entry
                    entry_allowed = is_first_entry or ce_signal_price_below_high
                    
                    if entry_allowed:
                        trade_placed = True
                        position = 1  # CE (long)
                        entry_price = current_candle['close']
                        signal_candles_with_entry.add(signal_candle_index)
                        ce_signal_price_below_high = False
                        # Store signal candle info for exit logic
                        active_trade_signal_candle = {
                            'high': ce_signal_candle['high'],
                            'low': ce_signal_candle['low'],
                            'type': 'CE'
                        }
                        trades.append({
                            'signal_time': ce_signal_candle['date'],
                            'signal_type': 'CE',
                            'signal_high': ce_signal_candle['high'],
                            'signal_low': ce_signal_candle['low'],
                            'entry_time': current_candle['date'],
                            'entry_price': entry_price,
                            'exit_time': None,
                            'exit_price': None,
                            'exit_type': None,
                            'pnl': None,
                            'pnl_percent': None,
                            'date': current_candle['date'].date() if isinstance(current_candle['date'], datetime.datetime) else current_candle['date'],
                            'lot_size': lot_size_value,
                            'option_trade_id': None,
                            'option_symbol': None,
                            'option_entry_price': None,
                            'stop_loss_price': None,
                            'target_price': None,
                            'option_exit_price': None
                        })
                        consecutive_candles_for_target = 0
                        last_candle_low_greater_than_ema = False

                        trade_index = len(trades) - 1
                        trade_date_value = trades[trade_index]['date']
                        atm_strike = round_to_atm_price(entry_price, strike_step)
                        option_symbol = get_option_symbol_from_components(instrument_key, atm_strike, 'CE', current_candle['date'])
                        option_entry_price = simulate_option_premium(entry_price, atm_strike, 'CE')
                        stop_loss_price_abs = round(option_entry_price * (1 + stop_loss_percent), 2)
                        target_price_abs = round(option_entry_price * (1 + target_percent), 2)

                        option_trade = {
                            'id': option_trade_sequence,
                            'index_trade_index': trade_index,
                            'signal_time': ce_signal_candle['date'],
                            'signal_type': 'CE',
                            'signal_high': float(ce_signal_candle['high']),
                            'signal_low': float(ce_signal_candle['low']),
                            'entry_time': current_candle['date'],
                            'index_at_entry': float(entry_price),
                            'atm_strike': float(atm_strike),
                            'option_symbol': option_symbol,
                            'option_entry_price': float(option_entry_price),
                            'stop_loss_price': float(stop_loss_price_abs),
                            'target_price': float(target_price_abs),
                            'option_exit_price': None,
                            'exit_time': None,
                            'exit_type': None,
                            'pnl': None,
                            'pnl_percent': None,
                            'status': 'open',
                            'lot_size': lot_size_value,
                            'date': trade_date_value
                        }
                        option_trades.append(option_trade)
                        option_trade_sequence += 1
                        trades[trade_index]['option_trade_id'] = option_trade['id']
                        trades[trade_index]['option_symbol'] = option_symbol
                        trades[trade_index]['option_entry_price'] = float(option_entry_price)
                        trades[trade_index]['stop_loss_price'] = float(stop_loss_price_abs)
                        trades[trade_index]['target_price'] = float(target_price_abs)
                        active_option_trade = option_trade

            # Exit Logic with DSL-driven priorities
            elif trade_placed:
                candle_time_obj = current_candle['date']
                if isinstance(candle_time_obj, datetime.datetime):
                    candle_time_check = candle_time_obj.time()
                else:
                    candle_time_check = datetime.datetime.now().time()

                current_trade_index = len(trades) - 1
                current_trade = trades[current_trade_index] if current_trade_index >= 0 else None

                linked_option_trade = None
                option_exit_price = None
                option_exit_type = None
                if active_option_trade and current_trade and current_trade.get('option_trade_id') == active_option_trade.get('id'):
                    linked_option_trade = active_option_trade
                    option_exit_price = simulate_option_premium(
                        current_candle['close'],
                        linked_option_trade['atm_strike'],
                        linked_option_trade['signal_type']
                    )
                    if option_exit_price <= linked_option_trade['stop_loss_price']:
                        option_exit_type = 'OPTION_STOP_LOSS'
                    elif option_exit_price >= linked_option_trade['target_price']:
                        option_exit_type = 'OPTION_TARGET'

                if option_exit_type and current_trade:
                    lot_size_for_trade = current_trade.get('lot_size', lot_size_value)
                    entry_price_value = current_trade['entry_price']
                    exit_price_value = current_candle['close']
                    if position == -1:
                        pnl_val = (entry_price_value - exit_price_value) * lot_size_for_trade
                        pnl_percent_val = ((entry_price_value - exit_price_value) / entry_price_value) * 100 if entry_price_value else 0
                    else:
                        pnl_val = (exit_price_value - entry_price_value) * lot_size_for_trade
                        pnl_percent_val = ((exit_price_value - entry_price_value) / entry_price_value) * 100 if entry_price_value else 0

                    current_trade['exit_time'] = current_candle['date']
                    current_trade['exit_price'] = exit_price_value
                    current_trade['exit_type'] = option_exit_type
                    current_trade['pnl'] = pnl_val
                    current_trade['pnl_percent'] = pnl_percent_val
                    current_trade['option_exit_price'] = option_exit_price

                    if linked_option_trade:
                        entry_opt_price = linked_option_trade.get('option_entry_price')
                        lot_size_opt = linked_option_trade.get('lot_size', lot_size_for_trade)
                        linked_option_trade['option_exit_price'] = option_exit_price
                        linked_option_trade['exit_time'] = current_candle['date']
                        linked_option_trade['exit_type'] = option_exit_type
                        if entry_opt_price:
                            linked_option_trade['pnl'] = (option_exit_price - entry_opt_price) * lot_size_opt
                            linked_option_trade['pnl_percent'] = ((option_exit_price - entry_opt_price) / entry_opt_price) * 100 if entry_opt_price else None
                        linked_option_trade['status'] = 'closed'
                        active_option_trade = None

                    trade_placed = False
                    position = 0
                    active_trade_signal_candle = None
                    consecutive_candles_for_target = 0
                    if current_trade['signal_type'] == 'PE':
                        pe_signal_price_above_low = False
                        last_candle_high_less_than_ema = False
                    else:
                        ce_signal_price_below_high = False
                        last_candle_low_greater_than_ema = False
                    continue

                if current_trade:
                    market_close_square_off_time = datetime.time(15, 15)
                    if market_close_square_off_time <= candle_time_check < datetime.time(15, 30):
                        lot_size_for_trade = current_trade.get('lot_size', lot_size_value)
                        entry_price_value = current_trade['entry_price']
                        exit_price_value = current_candle['close']
                        if position == -1:
                            pnl_val = (entry_price_value - exit_price_value) * lot_size_for_trade
                            pnl_percent_val = ((entry_price_value - exit_price_value) / entry_price_value) * 100 if entry_price_value else 0
                        else:
                            pnl_val = (exit_price_value - entry_price_value) * lot_size_for_trade
                            pnl_percent_val = ((exit_price_value - entry_price_value) / entry_price_value) * 100 if entry_price_value else 0

                        option_exit_price_mc = None
                        if linked_option_trade:
                            option_exit_price_mc = simulate_option_premium(
                                current_candle['close'],
                                linked_option_trade['atm_strike'],
                                linked_option_trade['signal_type']
                            )
                            entry_opt_price = linked_option_trade.get('option_entry_price')
                            lot_size_opt = linked_option_trade.get('lot_size', lot_size_for_trade)
                            linked_option_trade['option_exit_price'] = option_exit_price_mc
                            linked_option_trade['exit_time'] = current_candle['date']
                            linked_option_trade['exit_type'] = 'MARKET_CLOSE'
                            if entry_opt_price:
                                linked_option_trade['pnl'] = (option_exit_price_mc - entry_opt_price) * lot_size_opt
                                linked_option_trade['pnl_percent'] = ((option_exit_price_mc - entry_opt_price) / entry_opt_price) * 100 if entry_opt_price else None
                            linked_option_trade['status'] = 'closed'
                            active_option_trade = None

                        current_trade['exit_time'] = current_candle['date']
                        current_trade['exit_price'] = exit_price_value
                        current_trade['exit_type'] = 'MKT_CLOSE'
                        current_trade['pnl'] = pnl_val
                        current_trade['pnl_percent'] = pnl_percent_val
                        current_trade['option_exit_price'] = option_exit_price_mc

                        trade_placed = False
                        position = 0
                        active_trade_signal_candle = None
                        consecutive_candles_for_target = 0
                        if current_trade['signal_type'] == 'PE':
                            pe_signal_price_above_low = False
                            last_candle_high_less_than_ema = False
                        else:
                            ce_signal_price_below_high = False
                            last_candle_low_greater_than_ema = False
                        continue

                if position == -1 and active_trade_signal_candle is not None and active_trade_signal_candle['type'] == 'PE':
                    lot_size_for_trade = current_trade.get('lot_size', lot_size_value) if current_trade else lot_size_value
                    entry_price_value = current_trade['entry_price'] if current_trade else 0

                    if current_candle['close'] > active_trade_signal_candle['high']:
                        exit_price_value = current_candle['close']
                        pnl_val = (entry_price_value - exit_price_value) * lot_size_for_trade
                        pnl_percent_val = ((entry_price_value - exit_price_value) / entry_price_value) * 100 if entry_price_value else 0
                        option_exit_price_idx = None
                        if linked_option_trade:
                            option_exit_price_idx = simulate_option_premium(
                                current_candle['close'],
                                linked_option_trade['atm_strike'],
                                linked_option_trade['signal_type']
                            )
                            entry_opt_price = linked_option_trade.get('option_entry_price')
                            lot_size_opt = linked_option_trade.get('lot_size', lot_size_for_trade)
                            linked_option_trade['option_exit_price'] = option_exit_price_idx
                            linked_option_trade['exit_time'] = current_candle['date']
                            linked_option_trade['exit_type'] = 'INDEX_STOP'
                            if entry_opt_price:
                                linked_option_trade['pnl'] = (option_exit_price_idx - entry_opt_price) * lot_size_opt
                                linked_option_trade['pnl_percent'] = ((option_exit_price_idx - entry_opt_price) / entry_opt_price) * 100 if entry_opt_price else None
                            linked_option_trade['status'] = 'closed'
                            active_option_trade = None

                        current_trade['exit_time'] = current_candle['date']
                        current_trade['exit_price'] = exit_price_value
                        current_trade['exit_type'] = 'INDEX_STOP'
                        current_trade['pnl'] = pnl_val
                        current_trade['pnl_percent'] = pnl_percent_val
                        current_trade['option_exit_price'] = option_exit_price_idx
                        trade_placed = False
                        position = 0
                        active_trade_signal_candle = None
                        pe_signal_price_above_low = False
                        consecutive_candles_for_target = 0
                        last_candle_high_less_than_ema = False
                    elif current_candle['high'] < current_ema:
                        last_candle_high_less_than_ema = True
                        consecutive_candles_for_target = 0
                    elif last_candle_high_less_than_ema and current_candle['close'] > current_ema:
                        consecutive_candles_for_target += 1
                        if consecutive_candles_for_target >= 2:
                            exit_price_value = current_candle['close']
                            pnl_val = (entry_price_value - exit_price_value) * lot_size_for_trade
                            pnl_percent_val = ((entry_price_value - exit_price_value) / entry_price_value) * 100 if entry_price_value else 0
                            option_exit_price_idx = None
                            if linked_option_trade:
                                option_exit_price_idx = simulate_option_premium(
                                    current_candle['close'],
                                    linked_option_trade['atm_strike'],
                                    linked_option_trade['signal_type']
                                )
                                entry_opt_price = linked_option_trade.get('option_entry_price')
                                lot_size_opt = linked_option_trade.get('lot_size', lot_size_for_trade)
                                linked_option_trade['option_exit_price'] = option_exit_price_idx
                                linked_option_trade['exit_time'] = current_candle['date']
                                linked_option_trade['exit_type'] = 'INDEX_TARGET'
                                if entry_opt_price:
                                    linked_option_trade['pnl'] = (option_exit_price_idx - entry_opt_price) * lot_size_opt
                                    linked_option_trade['pnl_percent'] = ((option_exit_price_idx - entry_opt_price) / entry_opt_price) * 100 if entry_opt_price else None
                                linked_option_trade['status'] = 'closed'
                                active_option_trade = None

                            current_trade['exit_time'] = current_candle['date']
                            current_trade['exit_price'] = exit_price_value
                            current_trade['exit_type'] = 'INDEX_TARGET'
                            current_trade['pnl'] = pnl_val
                            current_trade['pnl_percent'] = pnl_percent_val
                            current_trade['option_exit_price'] = option_exit_price_idx
                            trade_placed = False
                            position = 0
                            active_trade_signal_candle = None
                            pe_signal_price_above_low = False
                            consecutive_candles_for_target = 0
                            last_candle_high_less_than_ema = False

                elif position == 1 and active_trade_signal_candle is not None and active_trade_signal_candle['type'] == 'CE':
                    lot_size_for_trade = current_trade.get('lot_size', lot_size_value) if current_trade else lot_size_value
                    entry_price_value = current_trade['entry_price'] if current_trade else 0

                    if current_candle['close'] < active_trade_signal_candle['low']:
                        exit_price_value = current_candle['close']
                        pnl_val = (exit_price_value - entry_price_value) * lot_size_for_trade
                        pnl_percent_val = ((exit_price_value - entry_price_value) / entry_price_value) * 100 if entry_price_value else 0
                        option_exit_price_idx = None
                        if linked_option_trade:
                            option_exit_price_idx = simulate_option_premium(
                                current_candle['close'],
                                linked_option_trade['atm_strike'],
                                linked_option_trade['signal_type']
                            )
                            entry_opt_price = linked_option_trade.get('option_entry_price')
                            lot_size_opt = linked_option_trade.get('lot_size', lot_size_for_trade)
                            linked_option_trade['option_exit_price'] = option_exit_price_idx
                            linked_option_trade['exit_time'] = current_candle['date']
                            linked_option_trade['exit_type'] = 'INDEX_STOP'
                            if entry_opt_price:
                                linked_option_trade['pnl'] = (option_exit_price_idx - entry_opt_price) * lot_size_opt
                                linked_option_trade['pnl_percent'] = ((option_exit_price_idx - entry_opt_price) / entry_opt_price) * 100 if entry_opt_price else None
                            linked_option_trade['status'] = 'closed'
                            active_option_trade = None

                        current_trade['exit_time'] = current_candle['date']
                        current_trade['exit_price'] = exit_price_value
                        current_trade['exit_type'] = 'INDEX_STOP'
                        current_trade['pnl'] = pnl_val
                        current_trade['pnl_percent'] = pnl_percent_val
                        current_trade['option_exit_price'] = option_exit_price_idx
                        trade_placed = False
                        position = 0
                        active_trade_signal_candle = None
                        ce_signal_price_below_high = False
                        consecutive_candles_for_target = 0
                        last_candle_low_greater_than_ema = False
                    elif current_candle['low'] > current_ema:
                        last_candle_low_greater_than_ema = True
                        consecutive_candles_for_target = 0
                    elif last_candle_low_greater_than_ema and current_candle['close'] < current_ema:
                        consecutive_candles_for_target += 1
                        if consecutive_candles_for_target >= 2:
                            exit_price_value = current_candle['close']
                            pnl_val = (exit_price_value - entry_price_value) * lot_size_for_trade
                            pnl_percent_val = ((exit_price_value - entry_price_value) / entry_price_value) * 100 if entry_price_value else 0
                            option_exit_price_idx = None
                            if linked_option_trade:
                                option_exit_price_idx = simulate_option_premium(
                                    current_candle['close'],
                                    linked_option_trade['atm_strike'],
                                    linked_option_trade['signal_type']
                                )
                                entry_opt_price = linked_option_trade.get('option_entry_price')
                                lot_size_opt = linked_option_trade.get('lot_size', lot_size_for_trade)
                                linked_option_trade['option_exit_price'] = option_exit_price_idx
                                linked_option_trade['exit_time'] = current_candle['date']
                                linked_option_trade['exit_type'] = 'INDEX_TARGET'
                                if entry_opt_price:
                                    linked_option_trade['pnl'] = (option_exit_price_idx - entry_opt_price) * lot_size_opt
                                    linked_option_trade['pnl_percent'] = ((option_exit_price_idx - entry_opt_price) / entry_opt_price) * 100 if entry_opt_price else None
                                linked_option_trade['status'] = 'closed'
                                active_option_trade = None

                            current_trade['exit_time'] = current_candle['date']
                            current_trade['exit_price'] = exit_price_value
                            current_trade['exit_type'] = 'INDEX_TARGET'
                            current_trade['pnl'] = pnl_val
                            current_trade['pnl_percent'] = pnl_percent_val
                            current_trade['option_exit_price'] = option_exit_price_idx
                            trade_placed = False
                            position = 0
                            active_trade_signal_candle = None
                            ce_signal_price_below_high = False
                            consecutive_candles_for_target = 0
                            last_candle_low_greater_than_ema = False

        # Force-close any remaining open trade at the end of the dataset
        if trade_placed and trades:
            last_trade = trades[-1]
            last_candle = df.iloc[-1]
            exit_price_value = last_candle['close']
            lot_size_for_trade = last_trade.get('lot_size', lot_size_value)
            entry_price_value = last_trade['entry_price']
            if position == -1:
                pnl_val = (entry_price_value - exit_price_value) * lot_size_for_trade
                pnl_percent_val = ((entry_price_value - exit_price_value) / entry_price_value) * 100 if entry_price_value else 0
            else:
                pnl_val = (exit_price_value - entry_price_value) * lot_size_for_trade
                pnl_percent_val = ((exit_price_value - entry_price_value) / entry_price_value) * 100 if entry_price_value else 0

            option_exit_price_forced = None
            if active_option_trade and last_trade.get('option_trade_id') == active_option_trade.get('id'):
                option_exit_price_forced = simulate_option_premium(
                    exit_price_value,
                    active_option_trade['atm_strike'],
                    active_option_trade['signal_type']
                )
                entry_opt_price = active_option_trade.get('option_entry_price')
                lot_size_opt = active_option_trade.get('lot_size', lot_size_for_trade)
                active_option_trade['option_exit_price'] = option_exit_price_forced
                active_option_trade['exit_time'] = last_candle['date']
                active_option_trade['exit_type'] = 'FORCED_CLOSE'
                if entry_opt_price:
                    active_option_trade['pnl'] = (option_exit_price_forced - entry_opt_price) * lot_size_opt
                    active_option_trade['pnl_percent'] = ((option_exit_price_forced - entry_opt_price) / entry_opt_price) * 100 if entry_opt_price else None
                active_option_trade['status'] = 'closed'
                active_option_trade = None

            last_trade['exit_time'] = last_candle['date']
            last_trade['exit_price'] = exit_price_value
            last_trade['exit_type'] = 'FORCED_CLOSE'
            last_trade['pnl'] = pnl_val
            last_trade['pnl_percent'] = pnl_percent_val
            last_trade['option_exit_price'] = option_exit_price_forced
            trade_placed = False
            position = 0
            active_trade_signal_candle = None
            pe_signal_price_above_low = False
            ce_signal_price_below_high = False
            consecutive_candles_for_target = 0
            last_candle_high_less_than_ema = False
            last_candle_low_greater_than_ema = False

        if active_option_trade and active_option_trade.get('status') != 'closed':
            active_option_trade['status'] = 'open'
            active_option_trade = None

        # Calculate summary metrics
        closed_trades = [t for t in trades if t['exit_time'] is not None]
        total_trades = len(closed_trades)
        winning_trades = len([t for t in closed_trades if t['pnl'] and t['pnl'] > 0])
        losing_trades = len([t for t in closed_trades if t['pnl'] and t['pnl'] <= 0])
        win_rate = (winning_trades / total_trades * 100) if total_trades > 0 else 0
        total_pnl = sum([t['pnl'] for t in closed_trades if t['pnl'] is not None])
        average_pnl = total_pnl / total_trades if total_trades > 0 else 0

        option_closed_trades = [ot for ot in option_trades if ot.get('exit_time') is not None]
        option_total_trades = len(option_closed_trades)
        option_winning_trades = len([ot for ot in option_closed_trades if ot.get('pnl') and ot['pnl'] > 0])
        option_losing_trades = len([ot for ot in option_closed_trades if ot.get('pnl') and ot['pnl'] <= 0])
        option_win_rate = (option_winning_trades / option_total_trades * 100) if option_total_trades > 0 else 0
        option_total_pnl = sum([ot['pnl'] for ot in option_closed_trades if ot.get('pnl') is not None])
        option_average_pnl = option_total_pnl / option_total_trades if option_total_trades > 0 else 0

        # Calculate Max Drawdown
        cumulative_pnl = 0
        equity_curve = [0]
        for trade in closed_trades:
            if trade['pnl'] is not None:
                cumulative_pnl += trade['pnl']
                equity_curve.append(cumulative_pnl)
        
        if len(equity_curve) > 1:
            running_max = [equity_curve[0]]
            for i in range(1, len(equity_curve)):
                running_max.append(max(running_max[-1], equity_curve[i]))
            
            drawdowns = [(equity_curve[i] - running_max[i]) for i in range(len(equity_curve))]
            max_drawdown = min(drawdowns) if drawdowns else 0
            max_drawdown_percent = abs((max_drawdown / running_max[drawdowns.index(max_drawdown)]) * 100) if running_max[drawdowns.index(max_drawdown)] != 0 else 0
        else:
            max_drawdown = 0
            max_drawdown_percent = 0

        # Calculate Max Winning Day and Max Losing Day
        daily_pnl = {}
        for trade in closed_trades:
            if trade['pnl'] is not None:
                trade_date = trade['date']
                if isinstance(trade_date, datetime.date):
                    date_key = trade_date.isoformat()
                else:
                    date_key = str(trade_date)
                if date_key not in daily_pnl:
                    daily_pnl[date_key] = 0
                daily_pnl[date_key] += trade['pnl']

        max_winning_day = {'date': from_date_str, 'pnl': 0}
        max_losing_day = {'date': from_date_str, 'pnl': 0}
        for date_key, pnl in daily_pnl.items():
            if pnl > max_winning_day['pnl']:
                max_winning_day = {'date': date_key, 'pnl': pnl}
            if pnl < max_losing_day['pnl']:
                max_losing_day = {'date': date_key, 'pnl': pnl}

        option_daily_pnl: Dict[str, float] = {}
        for opt_trade in option_closed_trades:
            pnl_val = opt_trade.get('pnl')
            if pnl_val is None:
                continue
            opt_date = opt_trade.get('date')
            if isinstance(opt_date, datetime.date):
                opt_date_key = opt_date.isoformat()
            else:
                opt_date_key = str(opt_date)
            option_daily_pnl.setdefault(opt_date_key, 0.0)
            option_daily_pnl[opt_date_key] += pnl_val

        option_max_winning_day = {'date': from_date_str, 'pnl': 0}
        option_max_losing_day = {'date': from_date_str, 'pnl': 0}
        for date_key, pnl in option_daily_pnl.items():
            if pnl > option_max_winning_day['pnl']:
                option_max_winning_day = {'date': date_key, 'pnl': pnl}
            if pnl < option_max_losing_day['pnl']:
                option_max_losing_day = {'date': date_key, 'pnl': pnl}

        # Format trades for response
        formatted_trades = []
        for trade in trades:
            formatted_trades.append({
                'signalTime': trade['signal_time'].isoformat() if isinstance(trade['signal_time'], datetime.datetime) else str(trade['signal_time']),
                'signalType': trade['signal_type'],
                'signalHigh': float(trade['signal_high']),
                'signalLow': float(trade['signal_low']),
                'entryTime': trade['entry_time'].isoformat() if isinstance(trade['entry_time'], datetime.datetime) else str(trade['entry_time']),
                'entryPrice': float(trade['entry_price']),
                'exitTime': trade['exit_time'].isoformat() if isinstance(trade['exit_time'], datetime.datetime) else str(trade['exit_time']) if trade['exit_time'] else None,
                'exitPrice': float(trade['exit_price']) if trade['exit_price'] else None,
                'exitType': trade['exit_type'],
                'pnl': float(trade['pnl']) if trade['pnl'] is not None else None,
                'pnlPercent': float(trade['pnl_percent']) if trade['pnl_percent'] is not None else None,
                'date': trade['date'].isoformat() if isinstance(trade['date'], datetime.date) else str(trade['date']),
                'lotSize': int(trade['lot_size']) if trade.get('lot_size') is not None else None,
                'optionTradeId': trade.get('option_trade_id'),
                'optionSymbol': trade.get('option_symbol'),
                'optionEntryPrice': float(trade['option_entry_price']) if trade.get('option_entry_price') is not None else None,
                'stopLossPrice': float(trade['stop_loss_price']) if trade.get('stop_loss_price') is not None else None,
                'targetPrice': float(trade['target_price']) if trade.get('target_price') is not None else None,
                'optionExitPrice': float(trade['option_exit_price']) if trade.get('option_exit_price') is not None else None
            })

        formatted_option_trades = []
        for opt_trade in option_trades:
            formatted_option_trades.append({
                'id': opt_trade.get('id'),
                'indexTradeIndex': opt_trade.get('index_trade_index'),
                'signalTime': opt_trade.get('signal_time').isoformat() if isinstance(opt_trade.get('signal_time'), datetime.datetime) else str(opt_trade.get('signal_time')),
                'signalType': opt_trade.get('signal_type'),
                'signalHigh': float(opt_trade.get('signal_high')) if opt_trade.get('signal_high') is not None else None,
                'signalLow': float(opt_trade.get('signal_low')) if opt_trade.get('signal_low') is not None else None,
                'entryTime': opt_trade.get('entry_time').isoformat() if isinstance(opt_trade.get('entry_time'), datetime.datetime) else str(opt_trade.get('entry_time')),
                'indexAtEntry': float(opt_trade.get('index_at_entry')) if opt_trade.get('index_at_entry') is not None else None,
                'atmStrike': float(opt_trade.get('atm_strike')) if opt_trade.get('atm_strike') is not None else None,
                'optionSymbol': opt_trade.get('option_symbol'),
                'optionEntryPrice': float(opt_trade.get('option_entry_price')) if opt_trade.get('option_entry_price') is not None else None,
                'stopLossPrice': float(opt_trade.get('stop_loss_price')) if opt_trade.get('stop_loss_price') is not None else None,
                'targetPrice': float(opt_trade.get('target_price')) if opt_trade.get('target_price') is not None else None,
                'optionExitPrice': float(opt_trade.get('option_exit_price')) if opt_trade.get('option_exit_price') is not None else None,
                'exitTime': opt_trade.get('exit_time').isoformat() if isinstance(opt_trade.get('exit_time'), datetime.datetime) else str(opt_trade.get('exit_time')) if opt_trade.get('exit_time') else None,
                'exitType': opt_trade.get('exit_type'),
                'pnl': float(opt_trade.get('pnl')) if opt_trade.get('pnl') is not None else None,
                'pnlPercent': float(opt_trade.get('pnl_percent')) if opt_trade.get('pnl_percent') is not None else None,
                'status': opt_trade.get('status'),
                'lotSize': int(opt_trade.get('lot_size')) if opt_trade.get('lot_size') is not None else None,
                'date': opt_trade.get('date').isoformat() if isinstance(opt_trade.get('date'), datetime.date) else str(opt_trade.get('date'))
            })

        return jsonify({
            'status': 'success',
            'trades': formatted_trades,
            'optionTrades': formatted_option_trades,
            'summary': {
                'totalTrades': total_trades,
                'winningTrades': winning_trades,
                'losingTrades': losing_trades,
                'winRate': round(win_rate, 2),
                'totalPnl': round(total_pnl, 2),
                'averagePnl': round(average_pnl, 2),
                'maxDrawdown': round(abs(max_drawdown), 2),
                'maxDrawdownPercent': round(max_drawdown_percent, 2),
                'roiPercent': round(((total_pnl) / abs(max_drawdown) * 100) if max_drawdown != 0 else win_rate, 2),
                'maxWinningDay': max_winning_day,
                'maxLosingDay': max_losing_day
            },
            'optionSummary': {
                'totalTrades': option_total_trades,
                'winningTrades': option_winning_trades,
                'losingTrades': option_losing_trades,
                'winRate': round(option_win_rate, 2),
                'totalPnl': round(option_total_pnl, 2),
                'averagePnl': round(option_average_pnl, 2),
                'maxDrawdown': 0,
                'maxDrawdownPercent': 0,
                'roiPercent': round((option_total_pnl / abs(max_drawdown) * 100) if max_drawdown != 0 else option_win_rate, 2),
                'maxWinningDay': option_max_winning_day,
                'maxLosingDay': option_max_losing_day
            }
        })

    except Exception as e:
        logging.error(f"Error in backtest_mountain_signal: {e}", exc_info=True)
        return jsonify({'status': 'error', 'message': f'Error running backtest: {str(e)}'}), 500


@app.route("/api/optimizer_mountain_signal", methods=['POST'])
def api_optimizer_mountain_signal():
    """Optimize Mountain Signal strategy over extended date range with adjustable option SL/TP."""
    if 'user_id' not in session:
        return jsonify({'status': 'error', 'message': 'User not logged in'}), 401

    try:
        data = request.get_json() or {}
        from_date_str = data.get('from_date')
        to_date_str = data.get('to_date')
        instrument = data.get('instrument', 'BANKNIFTY')
        candle_time = data.get('candle_time', '5')
        ema_period = data.get('ema_period', 5)
        stop_loss_input = data.get('option_stop_loss_percent')
        target_input = data.get('option_target_percent')
        initial_investment_input = data.get('initial_investment')

        if not from_date_str or not to_date_str:
            return jsonify({'status': 'error', 'message': 'From date and to date are required'}), 400

        from_date = datetime.datetime.strptime(from_date_str, '%Y-%m-%d').date()
        to_date = datetime.datetime.strptime(to_date_str, '%Y-%m-%d').date()
        if from_date > to_date:
            return jsonify({'status': 'error', 'message': 'From date must be before To date'}), 400

        days_diff = (to_date - from_date).days
        if days_diff > 365 * 3:
            return jsonify({'status': 'error', 'message': 'Maximum 3 years allowed'}), 400

        try:
            rules_data = load_mountain_signal_pe_rules()
        except Exception as rules_error:
            logging.error(f"Failed to load Mountain Signal PE rules for optimizer: {rules_error}", exc_info=True)
            rules_data = {
                'option_trade': {
                    'stop_loss_percent': -0.17,
                    'target_percent': 0.45
                },
                'lot_sizes': {
                    'BANKNIFTY': 35,
                    'NIFTY': 75
                },
                'strike_rounding': {
                    'BANKNIFTY': 100,
                    'NIFTY': 50
                }
            }

        instrument_key = 'BANKNIFTY' if 'BANK' in instrument.upper() else 'NIFTY'

        strike_rounding_map = {
            key.upper(): int(value)
            for key, value in (rules_data.get('strike_rounding') or {}).items()
            if value is not None
        }
        lot_sizes_map = {
            key.upper(): int(value)
            for key, value in (rules_data.get('lot_sizes') or {}).items()
            if value is not None
        }

        strike_step_default = 100 if instrument_key == 'BANKNIFTY' else 50
        lot_size_default = 35 if instrument_key == 'BANKNIFTY' else 75

        strike_step = strike_rounding_map.get(instrument_key, strike_step_default)
        lot_size_value = lot_sizes_map.get(instrument_key, lot_size_default)

        default_stop_loss_percent = rules_data.get('option_trade', {}).get('stop_loss_percent', -0.17)
        default_target_percent = rules_data.get('option_trade', {}).get('target_percent', 0.45)
        default_rsi_threshold_config = (rules_data.get('signals') or {}).get('PE') or (rules_data.get('signals') or {}).get('pe') or {}
        default_rsi_threshold = float(default_rsi_threshold_config.get('rsi_threshold', 70))

        stop_loss_percent = default_stop_loss_percent
        target_percent = default_target_percent
        rsi_threshold = default_rsi_threshold

        if stop_loss_input is not None:
            try:
                stop_loss_value = float(stop_loss_input)
                if abs(stop_loss_value) > 1:
                    stop_loss_percent = -abs(stop_loss_value) / 100.0
                else:
                    stop_loss_percent = stop_loss_value if stop_loss_value <= 0 else -abs(stop_loss_value)
            except (TypeError, ValueError):
                pass

        if target_input is not None:
            try:
                target_value = float(target_input)
                if abs(target_value) > 1:
                    target_percent = abs(target_value) / 100.0
                else:
                    target_percent = abs(target_value)
            except (TypeError, ValueError):
                pass

        rsi_threshold_input = data.get('rsi_threshold')
        if rsi_threshold_input is not None:
            try:
                rsi_threshold = float(rsi_threshold_input)
            except (TypeError, ValueError):
                rsi_threshold = default_rsi_threshold

        if initial_investment_input is not None:
            try:
                initial_investment = float(initial_investment_input)
            except (TypeError, ValueError):
                initial_investment = 100000.0
        else:
            initial_investment = 100000.0

        if initial_investment <= 0:
            return jsonify({'status': 'error', 'message': 'Initial investment must be greater than 0'}), 400

        if instrument.upper() == 'NIFTY':
            token = 256265
        elif instrument.upper() == 'BANKNIFTY':
            token = 260105
        else:
            return jsonify({'status': 'error', 'message': 'Invalid instrument'}), 400

        all_candles: List[Dict[str, Any]] = []
        current_date = from_date
        kite_interval = f"{candle_time}minute"

        while current_date <= to_date:
            if current_date.weekday() < 5:
                start_dt = datetime.datetime.combine(current_date, datetime.time(9, 15))
                end_dt = datetime.datetime.combine(current_date, datetime.time(15, 30))
                try:
                    hist = execute_with_retries(
                        f"fetching {kite_interval} historical data for token {token} on {current_date}",
                        lambda: kite.historical_data(token, start_dt, end_dt, kite_interval)
                    )
                    if hist:
                        all_candles.extend(hist)
                except kite_exceptions.TokenException:
                    raise
                except Exception as e:
                    logging.error(f"Error fetching historical data for {current_date}: {e}")
            current_date += datetime.timedelta(days=1)

        if not all_candles:
            return jsonify({'status': 'error', 'message': 'No historical data found for the selected date range'}), 404

        all_candles.sort(key=lambda x: x['date'])

        from utils.indicators import calculate_rsi
        import pandas as pd

        df_data = [{
            'date': candle['date'],
            'open': candle['open'],
            'high': candle['high'],
            'low': candle['low'],
            'close': candle['close']
        } for candle in all_candles]

        df = pd.DataFrame(df_data)
        df['ema'] = df['close'].ewm(span=ema_period, adjust=False).mean()

        if len(df) >= 15:
            df['rsi14'] = calculate_rsi(df['close'], period=14)
        else:
            df['rsi14'] = None

        trades, option_trades = run_mountain_signal_strategy_on_dataframe(
            df=df,
            instrument_key=instrument_key,
            lot_size_value=lot_size_value,
            strike_step=strike_step,
            stop_loss_percent=stop_loss_percent,
            target_percent=target_percent,
            rsi_overbought_threshold=rsi_threshold,
        )

        closed_trades = [t for t in trades if t.get('exit_time') is not None and t.get('pnl') is not None]
        closed_option_trades = [t for t in option_trades if t.get('exit_time') is not None and t.get('pnl') is not None]

        total_trades = len(closed_trades)
        winning_trades = len([t for t in closed_trades if t['pnl'] > 0])
        losing_trades = len([t for t in closed_trades if t['pnl'] <= 0])
        win_rate = (winning_trades / total_trades * 100) if total_trades > 0 else 0
        total_pnl = sum(t['pnl'] for t in closed_trades)
        average_pnl = total_pnl / total_trades if total_trades > 0 else 0

        total_option_trades = len(closed_option_trades)
        option_wins = len([t for t in closed_option_trades if t['pnl'] > 0])
        option_losses = len([t for t in closed_option_trades if t['pnl'] <= 0])
        option_win_rate = (option_wins / total_option_trades * 100) if total_option_trades > 0 else 0
        option_total_pnl = sum(t['pnl'] for t in closed_option_trades)
        option_average_pnl = option_total_pnl / total_option_trades if total_option_trades > 0 else 0

        daily_stats = aggregate_trades_by_period(closed_trades, 'daily')
        weekly_stats = aggregate_trades_by_period(closed_trades, 'weekly')
        monthly_stats = aggregate_trades_by_period(closed_trades, 'monthly')
        yearly_stats = aggregate_trades_by_period(closed_trades, 'yearly')

        option_daily_stats = aggregate_trades_by_period(closed_option_trades, 'daily')
        option_weekly_stats = aggregate_trades_by_period(closed_option_trades, 'weekly')
        option_monthly_stats = aggregate_trades_by_period(closed_option_trades, 'monthly')
        option_yearly_stats = aggregate_trades_by_period(closed_option_trades, 'yearly')

        best_day = max(daily_stats, key=lambda item: item['pnl']) if daily_stats else None
        worst_day = min(daily_stats, key=lambda item: item['pnl']) if daily_stats else None
        option_best_day = max(option_daily_stats, key=lambda item: item['pnl']) if option_daily_stats else None
        option_worst_day = min(option_daily_stats, key=lambda item: item['pnl']) if option_daily_stats else None

        open_trades_count = len([t for t in trades if t.get('exit_time') is None])
        open_option_trades_count = len([t for t in option_trades if t.get('exit_time') is None])

        max_drawdown_abs, max_drawdown_percent, roi_percent = compute_drawdown_metrics(closed_trades, initial_investment)
        option_max_drawdown_abs, option_max_drawdown_percent, option_roi_percent = compute_drawdown_metrics(closed_option_trades, initial_investment)

        return jsonify({
            'status': 'success',
            'summary': {
                'totalTrades': total_trades,
                'winningTrades': winning_trades,
                'losingTrades': losing_trades,
                'winRate': round(win_rate, 2),
                'totalPnl': round(total_pnl, 2),
                'averagePnl': round(average_pnl, 2),
                'maxDrawdown': round(max_drawdown_abs, 2),
                'maxDrawdownPercent': round(max_drawdown_percent, 2),
                'roiPercent': round(roi_percent, 2),
                'openTrades': open_trades_count,
                'bestDay': best_day,
                'worstDay': worst_day,
                'parameters': {
                    'stopLossPercent': round(abs(stop_loss_percent) * 100, 2),
                    'targetPercent': round(target_percent * 100, 2),
                    'lotSize': lot_size_value,
                    'strikeStep': strike_step,
                    'initialInvestment': round(initial_investment, 2),
                    'rsiThreshold': round(rsi_threshold, 2),
                },
                'dateRange': {
                    'from': from_date_str,
                    'to': to_date_str,
                    'days': days_diff + 1
                }
            },
            'optionSummary': {
                'totalTrades': total_option_trades,
                'winningTrades': option_wins,
                'losingTrades': option_losses,
                'winRate': round(option_win_rate, 2),
                'totalPnl': round(option_total_pnl, 2),
                'averagePnl': round(option_average_pnl, 2),
                'maxDrawdown': round(option_max_drawdown_abs, 2),
                'maxDrawdownPercent': round(option_max_drawdown_percent, 2),
                'roiPercent': round(option_roi_percent, 2),
                'openTrades': open_option_trades_count,
                'bestDay': option_best_day,
                'worstDay': option_worst_day,
                'parameters': {
                    'stopLossPercent': round(abs(stop_loss_percent) * 100, 2),
                    'targetPercent': round(target_percent * 100, 2),
                    'lotSize': lot_size_value,
                    'strikeStep': strike_step,
                    'initialInvestment': round(initial_investment, 2),
                    'rsiThreshold': round(rsi_threshold, 2),
                }
            },
            'timeframes': {
                'daily': daily_stats,
                'weekly': weekly_stats,
                'monthly': monthly_stats,
                'yearly': yearly_stats
            },
            'optionTimeframes': {
                'daily': option_daily_stats,
                'weekly': option_weekly_stats,
                'monthly': option_monthly_stats,
                'yearly': option_yearly_stats
            }
        })

    except Exception as e:
        logging.error(f"Error in optimizer_mountain_signal: {e}", exc_info=True)
        return jsonify({'status': 'error', 'message': f'Error running optimizer: {str(e)}'}), 500

@app.route("/backtest", methods=['POST'])
def backtest_strategy():
    if 'user_id' not in session:
        return jsonify({'status': 'error', 'message': 'User not logged in'}), 401

    # Extract strategy parameters from request form
    instrument = request.form.get('backtest-instrument')
    candle_time = request.form.get('candle-time') # Assuming this comes from the form
    execution_start = request.form.get('execution-start') # Assuming this comes from the form
    execution_end = request.form.get('execution-end') # Assuming this comes from the form
    stop_loss = float(request.form.get('stop-loss')) # Assuming this comes from the form
    target_profit = float(request.form.get('target-profit')) # Assuming this comes from the form
    total_lot = int(request.form.get('total-lot')) # Assuming this comes from the form
    trailing_stop_loss = float(request.form.get('trailing-stop-loss')) # Assuming this comes from the form
    segment = request.form.get('segment') # Assuming this comes from the form
    trade_type = request.form.get('trade-type') # Assuming this comes from the form
    strike_price = request.form.get('strike-price') # Assuming this comes from the form
    expiry_type = request.form.get('expiry-type') # Assuming this comes from the form
    from_date_str = request.form.get('backtest-from-date')
    to_date_str = request.form.get('backtest-to-date')

    # Convert date strings to datetime objects
    from_date = datetime.datetime.strptime(from_date_str, '%Y-%m-%d').date()
    to_date = datetime.datetime.strptime(to_date_str, '%Y-%m-%d').date()

    try:
        # Instantiate ORB strategy (using dummy kite for backtesting if not logged in)
        # In a real scenario, you might want to mock kite or ensure a valid connection for historical data
        current_kite = kite # Use the global kite instance

        orb_strategy = ORB(
            current_kite,
            instrument,
            candle_time,
            execution_start,
            execution_end,
            stop_loss,
            target_profit,
            total_lot,
            trailing_stop_loss,
            segment,
            trade_type,
            strike_price,
            expiry_type,
            "Backtest_ORB"
        )

        pnl, trades = orb_strategy.backtest(from_date, to_date)

        # Enhanced metrics calculation
        # Convert trades to format expected by metrics calculator
        trade_list = [{'pnl': pnl / trades if trades > 0 else 0, 'date': from_date} for _ in range(trades)]
        
        # Calculate comprehensive metrics
        metrics = calculate_all_metrics(trade_list, initial_capital=100000)
        metrics['simple_pnl'] = pnl
        metrics['simple_trades'] = trades

        return jsonify({
            'status': 'success',
            'pnl': pnl,
            'trades': trades,
            'metrics': metrics
        })
    except Exception as e:
        logging.error(f"Error during backtest: {e}")
        return jsonify({'status': 'error', 'message': f'Error during backtest: {e}'}), 500

@socketio.on('connect')
def connect(auth=None):
    """Handle SocketIO connection"""
    global ticker
    # Delay logging to avoid "write() before start_response" - log after connection is established
    user_id_from_session = None
    access_token_from_session = None
    access_token_present = False
    try:
        user_id_from_session = session.get('user_id')
        access_token_from_session = session.get('access_token')
        access_token_present = bool(access_token_from_session)
    except Exception as session_error:
        # Log session access errors for debugging
        try:
            logging.warning(f"SocketIO: Session access error during connect: {session_error}")
        except:
            pass  # Silently handle logging errors during handshake
    
    # Always accept connection to avoid WebSocket errors - handle invalid tokens gracefully
    try:
        access_token_valid = False
        if user_id_from_session and access_token_from_session:
            try:
                kite.set_access_token(access_token_from_session)
                kite.profile()  # Validate the token
                access_token_valid = True
            except Exception as e:
                error_msg = str(e)
                if "Invalid `api_key` or `access_token`" in error_msg or "Incorrect `api_key` or `access_token`" in error_msg:
                    try:
                        session.pop('access_token', None)
                    except:
                        pass  # Silently handle session errors
                    # Delay logging to avoid write() before start_response
                    try:
                        logging.warning("SocketIO: Invalid access token - accepting connection but not starting ticker")
                    except:
                        pass
                    # Accept connection but emit warning - don't start ticker
                    try:
                        emit('warning', {'message': 'Zerodha session expired. Please reconnect to Zerodha.'})
                    except:
                        pass  # If emit fails, connection is already established
                else:
                    # Delay logging to avoid write() before start_response
                    try:
                        logging.error(f"SocketIO: Error validating token: {e}")
                    except:
                        pass
                    # Accept connection but emit error
                    try:
                        emit('error', {'message': 'Error validating Zerodha session'})
                    except:
                        pass

            if access_token_valid:
                conn = get_db_connection()
                try:
                    # Use cached user_id to avoid accessing session during handshake
                    user_id = user_id_from_session
                    if not user_id:
                        conn.close()
                        return True  # Accept connection but don't proceed
                    user = conn.execute('SELECT * FROM users WHERE id = ?', (user_id,)).fetchone()
                    if user is None:
                        try:
                            logging.error(f"SocketIO connect error: User with ID {user_id} not found in DB.")
                        except:
                            pass
                        try:
                            emit('error', {'message': 'User not found'})
                        except:
                            pass
                    elif user['app_key'] is None or not access_token_present:
                        try:
                            logging.warning(f"SocketIO connect warning: User {user['id']} has no app_key or access_token.")
                        except:
                            pass
                        try:
                            emit('warning', {'message': 'Zerodha credentials not configured'})
                        except:
                            pass
                    else:
                        # Start ticker if not already started
                        if ticker is None:
                            try:
                                # Use cached access_token to avoid session access during handshake
                                if access_token_from_session:
                                    ticker = Ticker(user['app_key'], access_token_from_session, running_strategies, socketio, kite)
                                    ticker.start()
                                try:
                                    logging.info("SocketIO: Ticker started successfully")
                                except:
                                    pass
                            except Exception as e:
                                try:
                                    logging.error(f"SocketIO: Error starting ticker: {e}", exc_info=True)
                                except:
                                    pass  # Don't let logging errors break connection
                                ticker = None
                                try:
                                    emit('error', {'message': 'Failed to start market data feed'})
                                except:
                                    pass
                finally:
                    conn.close()
        else:
            try:
                logging.info("SocketIO: Connected without authentication (no user_id or access_token in session)")
            except:
                pass  # Don't let logging errors break connection
            try:
                emit('info', {'message': 'Connected. Please log in to receive real-time market data.'})
            except:
                pass
        
        # Always emit connection success
        try:
            emit('my_response', {'data': 'Connected'})
        except:
            pass  # If emit fails, connection might still work
        
        # Log after connection is established to avoid "write() before start_response"
        try:
            logging.info(f"SocketIO: Connection accepted - Session: user_id={user_id_from_session}, access_token={'present' if access_token_present else 'missing'}")
        except:
            pass  # Don't let logging errors break the connection
        
        return True  # Always accept connection to avoid WebSocket errors
    except Exception as e:
        # Log the full error for debugging
        try:
            import traceback
            error_trace = traceback.format_exc()
            logging.error(f"SocketIO connect error: {e}\n{error_trace}")
        except:
            try:
                logging.error(f"SocketIO connect error: {e}")
            except:
                pass  # Silently handle logging errors during handshake
        # Try to emit error to client
        try:
            emit('error', {'message': f'Connection error: {str(e)}'})
        except:
            pass
        # Always return True to avoid "write() before start_response" - errors are handled via emits
        return True  # Accept connection even on error

@socketio.on('start_ticker')
def handle_start_ticker(data=None):
    """Handle request to start ticker after login"""
    global ticker
    try:
        # Try to get session data - Flask-SocketIO should provide session access
        user_id_from_session = None
        access_token_from_session = None
        try:
            user_id_from_session = session.get('user_id')
            access_token_from_session = session.get('access_token')
        except Exception as e:
            logging.error(f"Error accessing session in start_ticker: {e}", exc_info=True)
            # Session might not be available in Socket.IO context, try alternative approach
            # Use request context if available
            try:
                with app.test_request_context():
                    user_id_from_session = session.get('user_id')
                    access_token_from_session = session.get('access_token')
            except Exception as e2:
                logging.error(f"Error accessing session via test_request_context: {e2}", exc_info=True)
        
        # If still no session, check if credentials were passed in data
        if (not user_id_from_session or not access_token_from_session) and data:
            # Allow passing credentials via event data as fallback (less secure but works)
            user_id_from_session = data.get('user_id') or user_id_from_session
            access_token_from_session = data.get('access_token') or access_token_from_session
        
        if not user_id_from_session or not access_token_from_session:
            logging.warning(f"start_ticker: user_id={user_id_from_session}, access_token={'present' if access_token_from_session else 'missing'}")
            emit('error', {'message': 'Not logged in. Please log in first. Session may not be available in Socket.IO context.'})
            return
        
        # Check if ticker is already running
        if ticker is not None:
            emit('info', {'message': 'Ticker is already running'})
            return
        
        # Validate access token
        try:
            kite.set_access_token(access_token_from_session)
            kite.profile()  # Validate the token
        except Exception as e:
            emit('error', {'message': f'Invalid access token: {str(e)}'})
            return
        
        # Get user data
        conn = get_db_connection()
        try:
            user = conn.execute('SELECT * FROM users WHERE id = ?', (user_id_from_session,)).fetchone()
            if not user:
                emit('error', {'message': 'User not found'})
                return
            
            if not user['app_key']:
                emit('error', {'message': 'Zerodha credentials not configured'})
                return
            
            # Start ticker
            ticker = Ticker(user['app_key'], access_token_from_session, running_strategies, socketio, kite)
            ticker.start()
            logging.info("SocketIO: Ticker started via start_ticker event")
            emit('info', {'message': 'Market data feed started successfully'})
        except Exception as e:
            logging.error(f"SocketIO: Error starting ticker via start_ticker event: {e}", exc_info=True)
            ticker = None
            emit('error', {'message': f'Failed to start market data feed: {str(e)}'})
        finally:
            conn.close()
    except Exception as e:
        logging.error(f"Error in start_ticker handler: {e}", exc_info=True)
        ticker = None
        try:
            emit('error', {'message': f'Error starting ticker: {str(e)}'})
        except:
            pass

@socketio.on('disconnect')
def disconnect():
    try:
        logging.info('Client disconnected')
    except Exception as e:
        # Silently handle disconnect errors to prevent "write() before start_response"
        pass
    return True

from strategies.orb import ORB

@app.route("/market_replay", methods=['POST'])
def market_replay():
    if 'user_id' not in session:
        return jsonify({'status': 'error', 'message': 'User not logged in'}), 401

    strategy_id = request.form.get('strategy')
    instrument_name = request.form.get('instrument')
    from_date_str = request.form.get('from-date')
    to_date_str = request.form.get('to-date')

    from_date = datetime.datetime.strptime(from_date_str, '%Y-%m-%d')
    to_date = datetime.datetime.strptime(to_date_str, '%Y-%m-%d')

    global instruments_df
    if instruments_df is None:
        try:
            instruments_df = kite.instruments()
        except Exception as e:
            logging.error(f"Error fetching instruments: {e}")
            return jsonify({'status': 'error', 'message': 'Could not fetch instruments'}), 500

    instrument = next((item for item in instruments_df if item["name"] == instrument_name and item["exchange"] == "NFO"), None)
    if not instrument:
        return jsonify({'status': 'error', 'message': f'Instrument {instrument_name} not found'}), 404
    instrument_token = instrument['instrument_token']

    conn = get_db_connection()
    strategy_data = conn.execute('SELECT * FROM strategies WHERE id = ? AND user_id = ?', (strategy_id, session['user_id'])).fetchone()

    if not strategy_data:
        return jsonify({'status': 'error', 'message': 'Strategy not found'}), 404

    ticks_rows = conn.execute(
        'SELECT * FROM tick_data WHERE instrument_token = ? AND timestamp BETWEEN ? AND ? ORDER BY timestamp',
        (instrument_token, from_date, to_date)
    ).fetchall()
    conn.close()

    if not ticks_rows:
        return jsonify({'status': 'error', 'message': 'No data found for the selected criteria'}), 404

    ticks = [dict(row) for row in ticks_rows]

    strategy_type = strategy_data['strategy_type']
    strategy_class = None
    if strategy_type == 'orb':
        strategy_class = ORB
    elif strategy_type == 'capture_mountain_signal':
        strategy_class = CaptureMountainSignal
    else:
        return jsonify({'status': 'error', 'message': 'Unknown strategy'}), 400

    strategy = strategy_class(
        None, # No kite object needed for replay
        strategy_data['instrument'],
        strategy_data['candle_time'],
        strategy_data['start_time'],
        strategy_data['end_time'],
        strategy_data['stop_loss'],
        strategy_data['target_profit'],
        strategy_data['total_lot'],
        strategy_data['trailing_stop_loss'],
        strategy_data['segment'],
        strategy_data['trade_type'],
        strategy_data['strike_price'],
        strategy_data['expiry_type'],
        strategy_data['strategy_name']
    )

    pnl, trades = strategy.replay(ticks)

    return jsonify({'status': 'success', 'pnl': pnl, 'trades': trades})

instruments_df = None

@app.route("/tick_data/<instrument_token>")
def tick_data(instrument_token):
    if 'user_id' not in session:
        return jsonify([]), 401

    conn = get_db_connection()
    tick_data_rows = conn.execute('SELECT * FROM tick_data WHERE instrument_token = ? ORDER BY timestamp DESC LIMIT 100', (instrument_token,)).fetchall()
    conn.close()

    tick_data = [dict(row) for row in tick_data_rows]
    return jsonify(tick_data)

@app.route("/tick_data_status")
def tick_data_status():
    global instruments_df
    if 'user_id' not in session:
        return jsonify([]), 401

    if instruments_df is None:
        try:
            instruments_df = kite.instruments()
        except Exception as e:
            logging.error(f"Error fetching instruments: {e}")
            return jsonify([]), 500

    conn = get_db_connection()
    status_rows = conn.execute('SELECT * FROM tick_data_status').fetchall()

    status_data = []
    for row in status_rows:
        instrument_token = row['instrument_token']
        status = row['status']

        # Find trading symbol from the dataframe
        instrument_details = next((item for item in instruments_df if item["instrument_token"] == instrument_token), None)
        trading_symbol = instrument_details['tradingsymbol'] if instrument_details else f"Unknown ({instrument_token})"

        row_count = conn.execute('SELECT COUNT(*) FROM tick_data WHERE instrument_token = ?', (instrument_token,)).fetchone()[0]
        last_collected_at_row = conn.execute('SELECT MAX(timestamp) FROM tick_data WHERE instrument_token = ?', (instrument_token,)).fetchone()
        last_collected_at = last_collected_at_row[0] if last_collected_at_row and last_collected_at_row[0] else 'N/A'

        status_data.append({
            'instrument': trading_symbol,
            'instrument_token': instrument_token,
            'status': status,
            'row_count': row_count,
            'last_collected_at': last_collected_at
        })

    conn.close()
    return jsonify(status_data)

@app.route("/tick_data/start", methods=['POST'])
def start_tick_collection():
    if 'user_id' not in session:
        return jsonify({'status': 'error', 'message': 'User not logged in'}), 401

    conn = get_db_connection()
    conn.execute('UPDATE tick_data_status SET status = \'Running\'')
    conn.commit()
    conn.close()
    return jsonify({'status': 'success'})

@app.route("/api/ticker/start", methods=['POST'])
def api_start_ticker():
    """HTTP endpoint to start the ticker after login"""
    global ticker
    if 'user_id' not in session:
        return jsonify({'status': 'error', 'message': 'User not logged in'}), 401
    
    if 'access_token' not in session:
        return jsonify({'status': 'error', 'message': 'Zerodha not connected. Please connect your Zerodha account first.'}), 401
    
    try:
        # Check if ticker is already running
        if ticker is not None:
            return jsonify({'status': 'success', 'message': 'Ticker is already running'})
        
        # Validate access token
        try:
            kite.set_access_token(session['access_token'])
            kite.profile()  # Validate the token
        except Exception as e:
            return jsonify({'status': 'error', 'message': f'Invalid access token: {str(e)}'}), 401
        
        # Get user data
        conn = get_db_connection()
        try:
            user = conn.execute('SELECT * FROM users WHERE id = ?', (session['user_id'],)).fetchone()
            if not user:
                return jsonify({'status': 'error', 'message': 'User not found'}), 404
            
            if not user['app_key']:
                return jsonify({'status': 'error', 'message': 'Zerodha credentials not configured'}), 400
            
            # Start ticker
            ticker = Ticker(user['app_key'], session['access_token'], running_strategies, socketio, kite)
            ticker.start()
            logging.info("Ticker started via /api/ticker/start endpoint")
            return jsonify({'status': 'success', 'message': 'Market data feed started successfully'})
        except Exception as e:
            logging.error(f"Error starting ticker via /api/ticker/start: {e}", exc_info=True)
            ticker = None
            return jsonify({'status': 'error', 'message': f'Failed to start market data feed: {str(e)}'}), 500
        finally:
            conn.close()
    except Exception as e:
        logging.error(f"Error in api_start_ticker: {e}", exc_info=True)
        ticker = None
        return jsonify({'status': 'error', 'message': f'Error starting ticker: {str(e)}'}), 500

@app.route("/api/market_snapshot", methods=['GET'])
def api_market_snapshot():
    """Return current snapshot prices for NIFTY and BANKNIFTY to avoid UI 'Loading...' before websocket ticks."""
    if 'user_id' not in session:
        return jsonify({'status': 'error', 'message': 'User not logged in'}), 401

    try:
        instruments = {
            'NIFTY': 'NSE:NIFTY 50',
            'BANKNIFTY': 'NSE:NIFTY BANK'
        }

        try:
            resp = _with_valid_kite_client(
                session['user_id'],
                "market snapshot",
                lambda client: execute_with_retries(
                    "fetching quick market snapshot",
                    lambda: client.ltp(list(instruments.values()))
                )
            )
        except kite_exceptions.TokenException:
            return jsonify({'status': 'error', 'message': 'Zerodha session expired', 'authExpired': True}), 401
        except RuntimeError as err:
            return jsonify({'status': 'error', 'message': str(err)}), 400

        nifty = resp.get(instruments['NIFTY'], {}).get('last_price')
        banknifty = resp.get(instruments['BANKNIFTY'], {}).get('last_price')
        data = {
            'status': 'success',
            'nifty': float(nifty) if nifty is not None else None,
            'banknifty': float(banknifty) if banknifty is not None else None
        }
        return jsonify(data)
    except Exception as e:
        logging.error(f"Error fetching market snapshot: {e}", exc_info=True)
        return jsonify({'status': 'error', 'message': 'Failed to fetch snapshot'}), 500

@app.route("/api/paper_trade/start", methods=['POST'])
def api_paper_trade_start():
    """Start paper trading for a strategy"""
    if 'user_id' not in session:
        return jsonify({'status': 'error', 'message': 'User not logged in'}), 401
    
    if 'access_token' not in session:
        return jsonify({'status': 'error', 'message': 'Zerodha not connected'}), 401

    try:
        data = request.get_json()
        strategy_id = data.get('strategy_id')
        
        if not strategy_id:
            return jsonify({'status': 'error', 'message': 'Strategy ID is required'}), 400

        conn = get_db_connection()
        strategy_data = conn.execute('SELECT * FROM strategies WHERE id = ? AND user_id = ?', (strategy_id, session['user_id'])).fetchone()
        conn.close()

        if not strategy_data:
            return jsonify({'status': 'error', 'message': 'Strategy not found'}), 404

        # Check if already running
        if strategy_id in paper_trade_strategies:
            return jsonify({'status': 'error', 'message': 'Paper trading already running for this strategy'}), 400

        # Validate strategy type
        strategy_type = strategy_data['strategy_type']
        if strategy_type != 'capture_mountain_signal':
            return jsonify({'status': 'error', 'message': 'Only Mountain Signal strategy is supported for paper trading'}), 400

        # Set access token
        kite.set_access_token(session['access_token'])

        # Determine expiry type based on instrument
        instrument = strategy_data['instrument']
        if instrument == 'BANKNIFTY':
            expiry_type = 'monthly'  # Monthly for BANKNIFTY
        elif instrument == 'NIFTY':
            expiry_type = 'weekly'  # Weekly for NIFTY
        else:
            # Try to get expiry_type from strategy_data, default to 'weekly'
            try:
                expiry_type = strategy_data['expiry_type']
            except (KeyError, IndexError):
                expiry_type = 'weekly'

        # Get ema_period with fallback
        try:
            ema_period = strategy_data['ema_period']
        except (KeyError, IndexError):
            ema_period = 5  # Default to 5 if not present
        
        # Create paper trade session in database first (to get session_id)
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO paper_trade_sessions 
            (user_id, strategy_id, strategy_name, instrument, expiry_type, candle_time, ema_period, started_at, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running')
        """, (
            session['user_id'],
            strategy_id,
            strategy_data['strategy_name'],
            instrument,
            expiry_type,
            strategy_data['candle_time'],
            ema_period,
            datetime.datetime.now()
        ))
        session_id = cursor.lastrowid
        conn.commit()
        conn.close()
        
        # Instantiate strategy with paper_trade=True and session_id
        strategy = CaptureMountainSignal(
            kite,
            instrument,
            strategy_data['candle_time'],
            strategy_data['start_time'],
            strategy_data['end_time'],
            strategy_data['stop_loss'],
            strategy_data['target_profit'],
            strategy_data['total_lot'],
            strategy_data['trailing_stop_loss'],
            strategy_data['segment'],
            strategy_data['trade_type'],
            strategy_data['strike_price'],
            expiry_type,  # Use determined expiry type
            f"{strategy_data['strategy_name']}_PaperTrade",
            paper_trade=True,
            ema_period=ema_period,
            session_id=session_id  # Pass session_id to strategy
        )
        
        strategy.run()
        
        # Store in paper_trade_strategies with session_id
        paper_trade_strategies[strategy_id] = {
            'strategy': strategy,
            'strategy_id': strategy_id,
            'user_id': session['user_id'],
            'session_id': session_id,
            'started_at': datetime.datetime.now(),
            'status': 'running'
        }

        # Add to running_strategies so ticker processes it
        unique_run_id = str(uuid.uuid4())
        running_strategies[unique_run_id] = {
            'strategy': strategy,
            'db_id': strategy_id,
            'name': strategy_data['strategy_name'],
            'instrument': instrument,
            'status': 'running',
            'paper_trade': True
        }

        # Emit initial status
        socketio.emit('paper_trade_update', {
            'status': 'Strategy started - Monitoring index for signals',
            'auditLog': {
                'id': 1,
                'timestamp': datetime.datetime.now().isoformat(),
                'type': 'info',
                'message': f'Paper Trading Started - {strategy_data["strategy_name"]}',
                'details': {
                    'instrument': instrument,
                    'expiry_type': expiry_type,
                    'candle_time': strategy_data['candle_time'],
                    'ema_period': ema_period
                }
            }
        }, room=f'paper_trade_{strategy_id}')

        return jsonify({
            'status': 'success',
            'message': 'Paper trading started successfully',
            'strategy_id': strategy_id
        })

    except Exception as e:
        logging.error(f"Error starting paper trade: {e}", exc_info=True)
        return jsonify({'status': 'error', 'message': f'Error starting paper trading: {str(e)}'}), 500

@app.route("/api/paper_trade/stop", methods=['POST'])
def api_paper_trade_stop():
    """Stop paper trading"""
    if 'user_id' not in session:
        return jsonify({'status': 'error', 'message': 'User not logged in'}), 401

    try:
        # Find and stop all paper trade strategies for this user
        strategies_to_stop = []
        for strategy_id, pt_info in list(paper_trade_strategies.items()):
            if pt_info['user_id'] == session['user_id']:
                strategies_to_stop.append(strategy_id)

        # Remove from running_strategies
        for unique_run_id, running_strat_info in list(running_strategies.items()):
            if running_strat_info.get('paper_trade') and running_strat_info['db_id'] in strategies_to_stop:
                del running_strategies[unique_run_id]

        # Remove from paper_trade_strategies and update DB
        conn = get_db_connection()
        for strategy_id in strategies_to_stop:
            if strategy_id in paper_trade_strategies:
                pt_info = paper_trade_strategies[strategy_id]
                session_id = pt_info.get('session_id')
                
                # Update session in database
                if session_id:
                    try:
                        cursor = conn.cursor()
                        # Calculate total trades and P&L from strategy status
                        strategy_status = pt_info['strategy'].status if hasattr(pt_info['strategy'], 'status') else {}
                        total_trades = strategy_status.get('total_trades', 0)
                        total_pnl = strategy_status.get('realized_pnl', 0) or strategy_status.get('pnl', 0)
                        
                        cursor.execute("""
                            UPDATE paper_trade_sessions 
                            SET stopped_at = ?, status = 'stopped', total_trades = ?, total_pnl = ?
                            WHERE id = ?
                        """, (datetime.datetime.now(), total_trades, total_pnl, session_id))
                        conn.commit()
                    except Exception as e:
                        logging.error(f"Error updating paper trade session: {e}", exc_info=True)
                        conn.rollback()
                
                # Emit stop event
                socketio.emit('paper_trade_update', {
                    'status': 'Stopped',
                    'auditLog': {
                        'id': 999,
                        'timestamp': datetime.datetime.now().isoformat(),
                        'type': 'info',
                        'message': 'Paper Trading Stopped',
                        'details': {}
                    }
                }, room=f'paper_trade_{strategy_id}')
                del paper_trade_strategies[strategy_id]
        conn.close()

        return jsonify({
            'status': 'success',
            'message': f'Stopped {len(strategies_to_stop)} paper trade strategy(ies)'
        })

    except Exception as e:
        logging.error(f"Error stopping paper trade: {e}", exc_info=True)
        return jsonify({'status': 'error', 'message': f'Error stopping paper trading: {str(e)}'}), 500

@socketio.on('join_paper_trade')
def on_join_paper_trade(data):
    """Join paper trade room for real-time updates"""
    if 'user_id' not in session:
        emit('error', {'message': 'Not authenticated'})
        return
    
    strategy_id = data.get('strategy_id')
    if strategy_id:
        room_name = f'paper_trade_{strategy_id}'
        from flask_socketio import join_room
        join_room(room_name)
        emit('info', {'message': f'Joined paper trade room for strategy {strategy_id}'})

@app.route("/api/paper_trade/sessions", methods=['GET'])
def api_paper_trade_sessions():
    """Get all paper trade sessions for the current user"""
    if 'user_id' not in session:
        return jsonify({'status': 'error', 'message': 'User not logged in'}), 401
    
    try:
        date_filter = request.args.get('date')  # Optional date filter (YYYY-MM-DD)
        
        conn = get_db_connection()
        if date_filter:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT id, strategy_id, strategy_name, instrument, expiry_type, 
                       candle_time, ema_period, started_at, stopped_at, status, 
                       total_trades, total_pnl
                FROM paper_trade_sessions
                WHERE user_id = ? AND DATE(started_at) = ?
                ORDER BY started_at DESC
            """, (session['user_id'], date_filter))
        else:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT id, strategy_id, strategy_name, instrument, expiry_type, 
                       candle_time, ema_period, started_at, stopped_at, status, 
                       total_trades, total_pnl
                FROM paper_trade_sessions
                WHERE user_id = ?
                ORDER BY started_at DESC
                LIMIT 100
            """, (session['user_id'],))
        
        sessions = []
        for row in cursor.fetchall():
            sessions.append({
                'id': row['id'],
                'strategy_id': row['strategy_id'],
                'strategy_name': row['strategy_name'],
                'instrument': row['instrument'],
                'expiry_type': row['expiry_type'],
                'candle_time': row['candle_time'],
                'ema_period': row['ema_period'],
                'started_at': row['started_at'],
                'stopped_at': row['stopped_at'],
                'status': row['status'],
                'total_trades': row['total_trades'],
                'total_pnl': row['total_pnl']
            })
        
        conn.close()
        return jsonify({'status': 'success', 'sessions': sessions})
    except Exception as e:
        logging.error(f"Error fetching paper trade sessions: {e}", exc_info=True)
        return jsonify({'status': 'error', 'message': f'Error fetching sessions: {str(e)}'}), 500

@app.route("/api/paper_trade/audit_trail/<int:session_id>", methods=['GET'])
def api_paper_trade_audit_trail(session_id):
    """Get audit trail for a specific paper trade session"""
    if 'user_id' not in session:
        return jsonify({'status': 'error', 'message': 'User not logged in'}), 401
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Verify session belongs to user
        cursor.execute("""
            SELECT user_id FROM paper_trade_sessions WHERE id = ?
        """, (session_id,))
        session_row = cursor.fetchone()
        
        if not session_row:
            conn.close()
            return jsonify({'status': 'error', 'message': 'Session not found'}), 404
        
        if session_row['user_id'] != session['user_id']:
            conn.close()
            return jsonify({'status': 'error', 'message': 'Unauthorized'}), 403
        
        # Fetch audit trail
        cursor.execute("""
            SELECT id, timestamp, log_type, message, details
            FROM paper_trade_audit_trail
            WHERE session_id = ?
            ORDER BY timestamp ASC
        """, (session_id,))
        
        import json
        audit_logs = []
        for row in cursor.fetchall():
            audit_logs.append({
                'id': row['id'],
                'timestamp': row['timestamp'],
                'type': row['log_type'],
                'message': row['message'],
                'details': json.loads(row['details']) if row['details'] else {}
            })
        
        conn.close()
        return jsonify({'status': 'success', 'audit_logs': audit_logs})
    except Exception as e:
        logging.error(f"Error fetching audit trail: {e}", exc_info=True)
        return jsonify({'status': 'error', 'message': f'Error fetching audit trail: {str(e)}'}), 500

@app.route("/api/market_replay", methods=['POST'])
def api_market_replay():
    if 'user_id' not in session:
        return jsonify({'status': 'error', 'message': 'User not logged in'}), 401
    
    if 'access_token' not in session:
        return jsonify({'status': 'error', 'message': 'Zerodha not connected. Please connect your Zerodha account first.'}), 401
    
    try:
        if request.is_json:
            data = request.get_json() or {}
            strategy_type = data.get('strategy')  # Strategy type: 'orb' or 'capture_mountain_signal'
            instrument_name = data.get('instrument') or data.get('instrument_name')
            from_date_str = data.get('from-date')
            to_date_str = data.get('to-date')
            speed = float(data.get('speed', 1))
        else:
            strategy_type = request.form.get('strategy')
            instrument_name = request.form.get('instrument') or request.form.get('instrument_name')
            from_date_str = request.form.get('from-date')
            to_date_str = request.form.get('to-date')
            speed = float(request.form.get('speed', 1))

        if not all([strategy_type, instrument_name, from_date_str, to_date_str]):
            return jsonify({'status': 'error', 'message': 'Missing required fields'}), 400

        # Parse dates
        from_date = datetime.datetime.strptime(from_date_str, '%Y-%m-%d').date()
        to_date = datetime.datetime.strptime(to_date_str, '%Y-%m-%d').date()
        
        # Ensure to_date is after from_date
        if to_date < from_date:
            return jsonify({'status': 'error', 'message': 'To date must be after from date'}), 400
        
        # Set access token
        kite.set_access_token(session['access_token'])
        
        # Get instrument token for index
        if instrument_name.upper() == 'NIFTY':
            instrument_token = 256265
            instrument_display = 'NIFTY 50'
        elif instrument_name.upper() == 'BANKNIFTY':
            instrument_token = 260105
            instrument_display = 'NIFTY BANK'
        else:
            return jsonify({'status': 'error', 'message': f'Unknown instrument: {instrument_name}'}), 400
        
        # Fetch historical candles from KiteConnect for all dates in range
        all_candles = []
        current_date = from_date
        candle_interval = '5minute'  # Default 5-minute candles, can be made configurable
        
        while current_date <= to_date:
            # Skip weekends
            if current_date.weekday() < 5:  # Monday=0, Friday=4
                start_dt = datetime.datetime.combine(current_date, datetime.time(9, 15))
                end_dt = datetime.datetime.combine(current_date, datetime.time(15, 30))
                
                try:
                    hist = execute_with_retries(
                        f"fetching {candle_interval} historical data for token {instrument_token} on {current_date}",
                        lambda: kite.historical_data(instrument_token, start_dt, end_dt, candle_interval)
                    )
                    if hist:
                        all_candles.extend(hist)
                except kite_exceptions.TokenException:
                    raise
                except Exception as e:
                    logging.error(f"Error fetching historical data for {current_date}: {e}")
            
            current_date += datetime.timedelta(days=1)
        
        if not all_candles:
            return jsonify({'status': 'error', 'message': 'No historical data found for the selected date range'}), 404
        
        # Sort candles by date
        all_candles.sort(key=lambda x: x['date'])
        
        # Create a default strategy configuration for replay
        # These are defaults - in production, you might want to fetch from saved strategies
        strategy_config = {
            'strategy_type': strategy_type,
            'instrument': instrument_name,
            'candle_time': '5',  # Default 5 minutes
            'start_time': '09:15',
            'end_time': '15:30',
            'stop_loss': '1.0',  # 1%
            'target_profit': '1.5',  # 1.5%
            'total_lot': 1,
            'trailing_stop_loss': '0.5',
            'segment': 'OPT',
            'trade_type': 'INTRADAY',
            'strike_price': 'ATM',
            'expiry_type': 'WEEKLY',
            'strategy_name': f'{strategy_type.upper()} Replay'
        }
        
        # Get session ID for Socket.IO room
        session_id = session.get('session_id', str(uuid.uuid4()))
        if 'session_id' not in session:
            session['session_id'] = session_id
        
        # Start replay using MarketReplayManager
        replay_manager = get_market_replay_manager()
        result = replay_manager.start_replay(
            session_id=session_id,
            user_id=session['user_id'],
            strategy_data=strategy_config,
            historical_candles=all_candles,
            instrument_token=instrument_token,
            instrument_display=instrument_display,
            speed=speed
        )
        
        if result.get('status') == 'error':
            return jsonify(result), 400
        
        return jsonify({
            'status': 'success', 
            'message': 'Market replay started',
            'session_id': session_id,
            'speed': speed,
            'total_candles': len(all_candles)
        })
    except ValueError as e:
        logging.error(f"api_market_replay validation error: {e}", exc_info=True)
        return jsonify({'status': 'error', 'message': str(e)}), 400
    except Exception as e:
        logging.error(f"api_market_replay error: {e}", exc_info=True)
        return jsonify({'status': 'error', 'message': 'Failed to start market replay'}), 500

# Global MarketReplayManager instance
_replay_manager = None

def get_market_replay_manager():
    global _replay_manager
    if _replay_manager is None:
        from market_replay_manager import MarketReplayManager
        _replay_manager = MarketReplayManager(socketio)
    return _replay_manager

# Socket.IO handlers for market replay controls
@socketio.on('replay_pause')
def handle_replay_pause():
    """Handle pause request for market replay"""
    try:
        session_id = session.get('session_id')
        if not session_id:
            emit('replay_error', {'message': 'No active replay session'})
            return
        
        replay_manager = get_market_replay_manager()
        if replay_manager.pause_replay(session_id):
            emit('replay_update', {'status': 'paused', 'message': 'Replay paused'})
        else:
            emit('replay_error', {'message': 'No active replay to pause'})
    except Exception as e:
        logging.error(f"Error pausing replay: {e}", exc_info=True)
        emit('replay_error', {'message': f'Error pausing replay: {str(e)}'})

@socketio.on('replay_resume')
def handle_replay_resume(data):
    """Handle resume request for market replay"""
    try:
        session_id = session.get('session_id')
        if not session_id:
            emit('replay_error', {'message': 'No active replay session'})
            return
        
        speed = data.get('speed', 1.0) if data else 1.0
        replay_manager = get_market_replay_manager()
        if replay_manager.resume_replay(session_id, speed):
            emit('replay_update', {'status': 'running', 'message': 'Replay resumed'})
        else:
            emit('replay_error', {'message': 'No paused replay to resume'})
    except Exception as e:
        logging.error(f"Error resuming replay: {e}", exc_info=True)
        emit('replay_error', {'message': f'Error resuming replay: {str(e)}'})

@socketio.on('replay_stop')
def handle_replay_stop():
    """Handle stop request for market replay"""
    try:
        session_id = session.get('session_id')
        if not session_id:
            emit('replay_error', {'message': 'No active replay session'})
            return
        
        replay_manager = get_market_replay_manager()
        if replay_manager.stop_replay(session_id):
            emit('replay_update', {'status': 'stopped', 'message': 'Replay stopped'})
        else:
            emit('replay_error', {'message': 'No active replay to stop'})
    except Exception as e:
        logging.error(f"Error stopping replay: {e}", exc_info=True)
        emit('replay_error', {'message': f'Error stopping replay: {str(e)}'})

@socketio.on('replay_speed_change')
def handle_replay_speed_change(data):
    """Handle speed change request for market replay"""
    try:
        session_id = session.get('session_id')
        if not session_id:
            emit('replay_error', {'message': 'No active replay session'})
            return
        
        speed = data.get('speed', 1.0) if data else 1.0
        replay_manager = get_market_replay_manager()
        if replay_manager.change_speed(session_id, speed):
            emit('replay_update', {'status': 'running', 'speed': speed, 'message': f'Speed changed to {speed}x'})
        else:
            emit('replay_error', {'message': 'No active replay to change speed'})
    except Exception as e:
        logging.error(f"Error changing replay speed: {e}", exc_info=True)
        emit('replay_error', {'message': f'Error changing replay speed: {str(e)}'})

@app.route("/tick_data/pause", methods=['POST'])
def pause_tick_collection():
    if 'user_id' not in session:
        return jsonify({'status': 'error', 'message': 'User not logged in'}), 401

    conn = get_db_connection()
    conn.execute('UPDATE tick_data_status SET status = \'Paused\'')
    conn.commit()
    conn.close()
    return jsonify({'status': 'success'})

@app.route("/tick_data/stop", methods=['POST'])
def stop_tick_collection():
    if 'user_id' not in session:
        return jsonify({'status': 'error', 'message': 'User not logged in'}), 401

    conn = get_db_connection()
    conn.execute('UPDATE tick_data_status SET status = \'Stopped\'')
    conn.commit()
    conn.close()
    return jsonify({'status': 'success'})

@app.route("/strategy/status/<strategy_id>")
@app.route("/api/strategy/status/<strategy_id>")
def strategy_status(strategy_id):
    if 'user_id' not in session:
        return jsonify({'status': 'error', 'message': 'User not logged in'}), 401

    try:
        strategy_id_int = int(strategy_id)
    except ValueError:
        return jsonify({'status': 'error', 'message': 'Invalid strategy ID'}), 400

    # Find the running strategy by its db_id
    for unique_run_id, running_strat_info in running_strategies.items():
        if running_strat_info.get('db_id') == strategy_id_int:
            try:
                strategy_obj = running_strat_info.get('strategy')
                status_data = {}
                
                if strategy_obj and hasattr(strategy_obj, 'status'):
                    status_dict = strategy_obj.status
                    if isinstance(status_dict, dict):
                        # Safely convert status dict to JSON-serializable format
                        for key, value in status_dict.items():
                            try:
                                # Handle None first
                                if value is None:
                                    status_data[key] = None
                                # Convert datetime objects to strings
                                elif isinstance(value, datetime.datetime):
                                    status_data[key] = value.isoformat()
                                # Convert date objects to strings
                                elif isinstance(value, datetime.date):
                                    status_data[key] = value.isoformat()
                                # Handle numpy types BEFORE basic types (np.float64 is not a regular float)
                                elif hasattr(value, '__class__'):
                                    try:
                                        import numpy as np
                                        if isinstance(value, (np.integer, np.floating)):
                                            status_data[key] = None if np.isnan(value) else value.item()
                                        elif hasattr(value, 'item'):
                                            status_data[key] = value.item()
                                        elif isinstance(value, dict):
                                            # Nested dict
                                            status_data[key] = {}
                                            for k, v in value.items():
                                                if isinstance(v, (datetime.datetime, datetime.date)):
                                                    status_data[key][k] = v.isoformat()
                                                elif hasattr(v, '__class__'):
                                                    try:
                                                        if isinstance(v, (np.integer, np.floating)):
                                                            status_data[key][k] = None if np.isnan(v) else v.item()
                                                        elif hasattr(v, 'item'):
                                                            status_data[key][k] = v.item()
                                                        else:
                                                            status_data[key][k] = str(v) if v is not None else None
                                                    except:
                                                        status_data[key][k] = str(v) if v is not None else None
                                                else:
                                                    status_data[key][k] = v
                                        elif isinstance(value, list):
                                            # List with numpy items
                                            processed_list = []
                                            for item in value:
                                                if isinstance(item, (datetime.datetime, datetime.date)):
                                                    processed_list.append(item.isoformat())
                                                elif hasattr(item, '__class__'):
                                                    try:
                                                        if isinstance(item, (np.integer, np.floating)):
                                                            processed_list.append(None if np.isnan(item) else item.item())
                                                        elif hasattr(item, 'item'):
                                                            processed_list.append(item.item())
                                                        else:
                                                            processed_list.append(str(item))
                                                    except:
                                                        processed_list.append(str(item) if item is not None else None)
                                                else:
                                                    processed_list.append(item)
                                            status_data[key] = processed_list
                                        else:
                                            status_data[key] = str(value) if value is not None else None
                                    except Exception as conv_err:
                                        logging.debug(f"Could not convert value for key '{key}': {conv_err}")
                                        status_data[key] = None
                                # Handle basic JSON-serializable types
                                elif isinstance(value, (bool, str)):
                                    status_data[key] = value
                                elif isinstance(value, int):
                                    status_data[key] = value
                                elif isinstance(value, float):
                                    # Check for NaN
                                    if value != value:  # NaN check
                                        status_data[key] = None
                                    else:
                                        status_data[key] = value
                                # Handle nested dicts (non-numpy)
                                elif isinstance(value, dict):
                                    status_data[key] = {k: (v.isoformat() if isinstance(v, (datetime.datetime, datetime.date)) else v) 
                                                       for k, v in value.items()}
                                # Handle lists (non-numpy)
                                elif isinstance(value, list):
                                    status_data[key] = [item.isoformat() if isinstance(item, (datetime.datetime, datetime.date)) else item 
                                                       for item in value]
                                # For unknown types, try string conversion or skip
                                else:
                                    try:
                                        status_data[key] = str(value) if value is not None else None
                                    except:
                                        pass  # Skip if can't convert
                            except Exception as e:
                                logging.warning(f"Error serializing status key '{key}': {e}")
                                continue
                
                status_data['strategy_type'] = running_strat_info.get('strategy_type', 'unknown')
                status_data['strategy_name_display'] = running_strat_info.get('name', 'Unknown Strategy')
                status_data['status'] = running_strat_info.get('status', 'running')
                status_data['running'] = True
                # Prefer aligned execution time from strategy if available
                try:
                    status_data['last_execution_time'] = strategy_obj.status.get('last_execution_time', datetime.datetime.now().isoformat())
                except Exception:
                    status_data['last_execution_time'] = datetime.datetime.now().isoformat()
                
                # Add historical candles if available
                if hasattr(strategy_obj, 'historical_data'):
                    candles = getattr(strategy_obj, 'historical_data', [])
                    historical_candles = []
                    for candle in candles[-50:]:  # Last 50 candles
                        try:
                            candle_date = candle.get('date') if isinstance(candle, dict) else getattr(candle, 'date', None)
                            if candle_date:
                                if isinstance(candle_date, datetime.datetime):
                                    date_str = candle_date.isoformat()
                                else:
                                    date_str = str(candle_date)
                            else:
                                date_str = datetime.datetime.now().isoformat()
                            
                            candle_dict = {
                                'time': date_str,
                                'open': candle.get('open') if isinstance(candle, dict) else getattr(candle, 'open', 0),
                                'high': candle.get('high') if isinstance(candle, dict) else getattr(candle, 'high', 0),
                                'low': candle.get('low') if isinstance(candle, dict) else getattr(candle, 'low', 0),
                                'close': candle.get('close') if isinstance(candle, dict) else getattr(candle, 'close', 0),
                                'volume': candle.get('volume', 0) if isinstance(candle, dict) else getattr(candle, 'volume', 0)
                            }
                            historical_candles.append(candle_dict)
                        except Exception as e:
                            logging.debug(f"Error processing candle for status: {e}")
                            continue
                    
                    # Calculate 5 EMA
                    if len(historical_candles) > 0 and hasattr(strategy_obj, 'ema_period'):
                        ema_period = getattr(strategy_obj, 'ema_period', 5)
                        if len(historical_candles) >= ema_period:
                            closes = [c['close'] for c in historical_candles]
                            multiplier = 2 / (ema_period + 1)
                            ema_values = []
                            ema = closes[0]
                            for close in closes:
                                ema = (close - ema) * multiplier + ema
                                ema_values.append(ema)
                            
                            for i, candle in enumerate(historical_candles):
                                if i < len(ema_values):
                                    candle['ema5'] = ema_values[i]
                    
                    status_data['historical_candles'] = historical_candles
                # Include today's signal history for UI
                try:
                    status_data['signal_history_today'] = strategy_obj.status.get('signal_history_today', [])
                except Exception:
                    status_data['signal_history_today'] = []
                return jsonify(status_data)
            except Exception as e:
                logging.error(f"Error getting strategy status for {strategy_id}: {e}", exc_info=True)
                return jsonify({
                    'status': 'error', 
                    'message': f'Error retrieving strategy status: {str(e)}',
                    'running': False
                }), 500
    
    # Strategy not in running_strategies - check database to see if it exists
    conn = get_db_connection()
    try:
        strategy_row = conn.execute(
            'SELECT strategy_name, status FROM strategies WHERE id = ? AND user_id = ?',
            (strategy_id_int, session['user_id'])
        ).fetchone()
        
        if strategy_row:
            # Strategy exists but is not currently running
            return jsonify({
                'status': 'not_running',
                'strategy_name_display': strategy_row['strategy_name'],
                'db_status': strategy_row['status'],
                'running': False,
                'message': f"Strategy '{strategy_row['strategy_name']}' is not currently running. Status: {strategy_row['status']}"
            })
        else:
            return jsonify({'status': 'error', 'message': 'Strategy not found'}), 404
    except Exception as e:
        logging.error(f"Error checking database for strategy {strategy_id}: {e}", exc_info=True)
        return jsonify({'status': 'error', 'message': 'Error checking strategy status'}), 500
    finally:
        conn.close()

# WebSocket handlers for strategy monitoring
@socketio.on('subscribe_strategy')
def handle_subscribe_strategy(data):
    """Subscribe to real-time updates for a specific strategy"""
    try:
        user_id = None
        try:
            user_id = session.get('user_id')
        except Exception:
            user_id = None
        if not user_id:
            try:
                emit('error', {'message': 'User not authenticated'})
            except Exception:
                pass
            return True

        strategy_id = (data or {}).get('strategy_id')
        if not strategy_id:
            try:
                emit('error', {'message': 'Strategy ID required'})
            except Exception:
                pass
            return True

        # Join a room for this strategy
        from flask_socketio import join_room
        room_name = f"strategy_{user_id}_{strategy_id}"
        try:
            join_room(room_name)
        except Exception:
            pass
        try:
            logging.info(f"User {user_id} subscribed to strategy {strategy_id}")
        except Exception:
            pass
        try:
            emit('subscribed', {'strategy_id': str(strategy_id), 'message': 'Subscribed to strategy updates'})
        except Exception:
            pass
        return True
    except Exception:
        return True

@socketio.on('unsubscribe_strategy')
def handle_unsubscribe_strategy(data):
    """Unsubscribe from strategy updates"""
    try:
        user_id = None
        try:
            user_id = session.get('user_id')
        except Exception:
            user_id = None
        if not user_id:
            return True

        strategy_id = (data or {}).get('strategy_id')
        if strategy_id:
            from flask_socketio import leave_room
            room_name = f"strategy_{user_id}_{strategy_id}"
            try:
                leave_room(room_name)
            except Exception:
                pass
            try:
                logging.info(f"User {user_id} unsubscribed from strategy {strategy_id}")
            except Exception:
                pass
        return True
    except Exception as e:
        logging.debug(f"Error in unsubscribe_strategy: {e}")
        return True  # Silently handle errors during disconnect

@socketio.on('subscribe_market_data')
def handle_subscribe_market_data(data):
    """Subscribe to market data for strategy monitoring"""
    try:
        user_id = None
        try:
            user_id = session.get('user_id')
        except Exception:
            user_id = None
        if not user_id:
            try:
                emit('error', {'message': 'User not authenticated'})
            except Exception:
                pass
            return True

        # Join market data room
        from flask_socketio import join_room
        room_name = f"market_data_{user_id}"
        try:
            join_room(room_name)
        except Exception:
            pass
        try:
            emit('subscribed', {'message': 'Subscribed to market data'})
        except Exception:
            pass
        return True
    except Exception:
        return True

# ========================= AI/ML: LSTM Training & Prediction =========================
@app.route('/api/aiml/train', methods=['POST'])
def api_aiml_train():
    try:
        data = request.get_json(force=True) if request.is_json else request.form
        symbol = (data.get('symbol') or 'NIFTY').upper()
        years = int(data.get('years', 2))
        horizon = int(data.get('horizon', 1))  # 1-6
        lookback = int(data.get('lookback', 60))
        epochs = int(data.get('epochs', 20))
        batch_size = int(data.get('batch_size', 64))

        if horizon < 1 or horizon > 6:
            return jsonify({'status': 'error', 'message': 'horizon must be between 1 and 6'}), 400

        token_map = {'NIFTY': 256265, 'BANKNIFTY': 260105}
        if symbol not in token_map:
            return jsonify({'status': 'error', 'message': 'Unsupported symbol. Use NIFTY or BANKNIFTY'}), 400
        instrument_token = token_map[symbol]

        end_date = datetime.date.today()
        start_date = end_date - datetime.timedelta(days=365 * years)
        all_candles = []
        current_date = start_date
        interval = '5minute'
        total_days = (end_date - start_date).days + 1
        day_index = 0
        logging.info(f"[AIML] Training request: symbol={symbol}, years={years}, horizon={horizon}, lookback={lookback}, epochs={epochs}, batch_size={batch_size}")
        while current_date <= end_date:
            start_dt = datetime.datetime.combine(current_date, datetime.time(9, 15))
            end_dt = datetime.datetime.combine(current_date, datetime.time(15, 30))
            try:
                hist = execute_with_retries(
                    f"fetching {interval} historical data for token {instrument_token} on {current_date}",
                    lambda: kite.historical_data(instrument_token, start_dt, end_dt, interval)
                )
                if hist:
                    all_candles.extend(hist)
            except kite_exceptions.TokenException:
                raise
            except Exception as e:
                logging.warning(f"Historical fetch failed for {current_date}: {e}")
            current_date += datetime.timedelta(days=1)
            day_index += 1
            if day_index % 20 == 0 or current_date > end_date:
                logging.info(f"[AIML] Fetch progress: {day_index}/{total_days} trading days processed, candles so far: {len(all_candles)}")

        if not all_candles:
            return jsonify({'status': 'error', 'message': 'No historical data fetched for training'}), 404

        model_dir = os.path.join(os.path.dirname(__file__), 'models')
        logging.info(f"[AIML] Starting LSTM training on {len(all_candles)} candles ...")
        result = train_lstm_on_candles(
            candles=all_candles,
            model_dir=model_dir,
            symbol=symbol,
            lookback=lookback,
            horizon=horizon,
            epochs=epochs,
            batch_size=batch_size,
        )
        logging.info(f"[AIML] Training complete. Model saved to {result.get('model_path')}")
        return jsonify({'status': 'ok', 'symbol': symbol, 'horizon': horizon, **result})
    except kite_exceptions.TokenException as e:
        logging.error(f"Error in api_aiml_train due to invalid session: {e}")
        return jsonify({'status': 'error', 'message': 'Zerodha session expired. Please login again.'}), 401
    except Exception as e:
        logging.error(f"Error in api_aiml_train: {e}", exc_info=True)
        return jsonify({'status': 'error', 'message': str(e)}), 500


@app.route('/api/aiml/predict', methods=['GET'])
def api_aiml_predict():
    try:
        symbol = (request.args.get('symbol') or 'NIFTY').upper()
        horizon = int(request.args.get('horizon', 1))
        steps = int(request.args.get('steps', 6))
        lookback = int(request.args.get('lookback', 60))
        if horizon < 1 or horizon > 6:
            return jsonify({'status': 'error', 'message': 'horizon must be between 1 and 6'}), 400
        if steps < 1 or steps > 6:
            steps = 6

        token_map = {'NIFTY': 256265, 'BANKNIFTY': 260105}
        if symbol not in token_map:
            return jsonify({'status': 'error', 'message': 'Unsupported symbol. Use NIFTY or BANKNIFTY'}), 400
        instrument_token = token_map[symbol]

        end_date = datetime.date.today()
        start_date = end_date - datetime.timedelta(days=7)
        all_candles = []
        current_date = start_date
        interval = '5minute'
        while current_date <= end_date and len(all_candles) < (lookback + 50):
            start_dt = datetime.datetime.combine(current_date, datetime.time(9, 15))
            end_dt = datetime.datetime.combine(current_date, datetime.time(15, 30))
            try:
                hist = execute_with_retries(
                    f"fetching {interval} historical data for token {instrument_token} on {current_date}",
                    lambda: kite.historical_data(instrument_token, start_dt, end_dt, interval)
                )
                if hist:
                    all_candles.extend(hist)
            except kite_exceptions.TokenException:
                raise
            except Exception as e:
                logging.warning(f"Historical fetch failed for {current_date}: {e}")
            current_date += datetime.timedelta(days=1)

        if len(all_candles) < lookback:
            return jsonify({'status': 'error', 'message': 'Not enough recent candles for prediction'}), 400

        model_dir = os.path.join(os.path.dirname(__file__), 'models')
        result = load_model_and_predict(
            model_dir=model_dir,
            symbol=symbol,
            candles=all_candles,
            horizon=horizon,
            lookback=lookback,
            steps_ahead=steps,
        )
        return jsonify({'status': 'ok', 'symbol': symbol, 'horizon': horizon, **result})
    except kite_exceptions.TokenException as e:
        logging.error(f"Error in api_aiml_predict due to invalid session: {e}")
        return jsonify({'status': 'error', 'message': 'Zerodha session expired. Please login again.'}), 401
    except Exception as e:
        logging.error(f"Error in api_aiml_predict: {e}", exc_info=True)
        return jsonify({'status': 'error', 'message': str(e)}), 500


# Full-series evaluation for overlay chart (3 years by default)
@app.route('/api/aiml/evaluate', methods=['GET'])
def api_aiml_evaluate():
    try:
        symbol = (request.args.get('symbol') or 'NIFTY').upper()
        years = int(request.args.get('years', 3))
        horizon = int(request.args.get('horizon', 1))
        lookback = int(request.args.get('lookback', 60))
        if horizon < 1 or horizon > 6:
            return jsonify({'status': 'error', 'message': 'horizon must be between 1 and 6'}), 400

        token_map = {'NIFTY': 256265, 'BANKNIFTY': 260105}
        if symbol not in token_map:
            return jsonify({'status': 'error', 'message': 'Unsupported symbol. Use NIFTY or BANKNIFTY'}), 400
        instrument_token = token_map[symbol]

        end_date = datetime.date.today()
        start_date = end_date - datetime.timedelta(days=365 * years)
        all_candles = []
        current_date = start_date
        interval = '5minute'
        total_days = (end_date - start_date).days + 1
        processed = 0
        while current_date <= end_date:
            start_dt = datetime.datetime.combine(current_date, datetime.time(9, 15))
            end_dt = datetime.datetime.combine(current_date, datetime.time(15, 30))
            try:
                hist = execute_with_retries(
                    f"fetching {interval} historical data for token {instrument_token} on {current_date}",
                    lambda: kite.historical_data(instrument_token, start_dt, end_dt, interval)
                )
                if hist:
                    all_candles.extend(hist)
            except kite_exceptions.TokenException:
                raise
            except Exception as e:
                logging.warning(f"Historical fetch failed for {current_date}: {e}")
            current_date += datetime.timedelta(days=1)
            processed += 1
            if processed % 40 == 0 or current_date > end_date:
                logging.info(f"[AIML] Evaluate fetch progress: {processed}/{total_days} days, candles: {len(all_candles)}")

        if len(all_candles) < (lookback + 100):
            return jsonify({'status': 'error', 'message': 'Insufficient candles for evaluation'}), 400

        # Prepare features and scaling consistent with training
        df = candles_to_dataframe(all_candles)
        scaler, scaled = prepare_training_data(df, lookback)

        # Ensure model is trained and available
        model_dir = os.path.join(os.path.dirname(__file__), 'models')
        try:
            model_result = load_model_and_predict(
                model_dir=model_dir,
                symbol=symbol,
                candles=all_candles[-max(len(all_candles), lookback+1):],
                horizon=horizon,
                lookback=lookback,
                steps_ahead=1,
            )
        except Exception:
            # If model not found or incompatible, train a quick model on full data (lower epochs to keep responsive)
            logging.info("[AIML] Model unavailable for evaluation; training a quick model for overlay...")
            _ = train_lstm_on_candles(
                candles=all_candles,
                model_dir=model_dir,
                symbol=symbol,
                lookback=lookback,
                horizon=horizon,
                epochs=10,
                batch_size=128,
            )

        # Build sequences across full dataset
        # Target aligns at t = i + lookback + horizon - 1
        feature_dim = scaled.shape[1]
        X_all = []
        y_all = []
        times = []
        total = scaled.shape[0]
        end_idx = total - lookback - horizon + 1
        for i in range(end_idx):
            X_all.append(scaled[i:i+lookback, :])
            y_all.append(scaled[i + lookback + horizon - 1, 0])
            times.append(df.index[i + lookback + horizon - 1].isoformat())
        X_all = np.array(X_all)
        y_all = np.array(y_all)

        # Load model again for prediction after possible quick-train
        _ = load_model_and_predict(
            model_dir=model_dir,
            symbol=symbol,
            candles=all_candles[-(lookback+200):],
            horizon=horizon,
            lookback=lookback,
            steps_ahead=1,
        )
        model, _ = load_lstm_checkpoint(model_dir, symbol, horizon)
        device = next(model.parameters()).device
        with torch.no_grad():
            tensor_all = torch.from_numpy(X_all).float().to(device)
            y_pred_scaled = model(tensor_all).cpu().numpy().reshape(-1)

        # Inverse-transform to prices
        last_row_template = np.zeros((feature_dim,))
        inv_actual = []
        inv_pred = []
        for a, p in zip(y_all, y_pred_scaled):
            row_a = last_row_template.copy(); row_a[0] = a
            row_p = last_row_template.copy(); row_p[0] = p
            inv_actual.append(float(scaler.inverse_transform(row_a.reshape(1,-1))[0][0]))
            inv_pred.append(float(scaler.inverse_transform(row_p.reshape(1,-1))[0][0]))

        # 70/30 split on sequence count
        split_index = int(0.7 * len(times))
        series = []
        for i in range(len(times)):
            series.append({
                'time': times[i],
                'actual': inv_actual[i],
                'predicted': inv_pred[i],
                'subset': 'train' if i < split_index else 'test'
            })

        return jsonify({'status': 'ok', 'symbol': symbol, 'horizon': horizon, 'lookback': lookback, 'split_index': split_index, 'series': series})
    except kite_exceptions.TokenException as e:
        logging.error(f"Error in api_aiml_evaluate due to invalid session: {e}")
        return jsonify({'status': 'error', 'message': 'Zerodha session expired. Please login again.'}), 401
    except Exception as e:
        logging.error(f"Error in api_aiml_evaluate: {e}", exc_info=True)
        return jsonify({'status': 'error', 'message': str(e)}), 500
# Backward-compatible aliases without /api prefix
@app.route('/aiml/train', methods=['POST'])
def api_aiml_train_compat():
    return api_aiml_train()


@app.route('/api/ai/lstm/train', methods=['POST', 'OPTIONS'])
def api_ai_lstm_train():
    if request.method == 'OPTIONS':
        return ('', 204)
    return api_aiml_train()


@app.route('/aiml/predict', methods=['GET'])
def api_aiml_predict_compat():
    return api_aiml_predict()


@app.route('/aiml/evaluate', methods=['GET'])
def api_aiml_evaluate_compat():
    return api_aiml_evaluate()


@app.route('/api/aiml/evaluate_date', methods=['GET'])
def api_aiml_evaluate_date():
    """Evaluate actual vs predicted for a specific date (single day's 5-minute candles)"""
    try:
        symbol = (request.args.get('symbol') or 'NIFTY').upper()
        date_str = request.args.get('date')  # Format: YYYY-MM-DD
        horizon = int(request.args.get('horizon', 1))
        lookback = int(request.args.get('lookback', 60))
        
        if not date_str:
            return jsonify({'status': 'error', 'message': 'Date parameter required (YYYY-MM-DD)'}), 400
        if horizon < 1 or horizon > 6:
            return jsonify({'status': 'error', 'message': 'horizon must be between 1 and 6'}), 400

        try:
            target_date = datetime.datetime.strptime(date_str, '%Y-%m-%d').date()
        except ValueError:
            return jsonify({'status': 'error', 'message': 'Invalid date format. Use YYYY-MM-DD'}), 400

        token_map = {'NIFTY': 256265, 'BANKNIFTY': 260105}
        if symbol not in token_map:
            return jsonify({'status': 'error', 'message': 'Unsupported symbol. Use NIFTY or BANKNIFTY'}), 400
        instrument_token = token_map[symbol]

        # Fetch data for the target date and enough prior days for lookback
        start_dt = datetime.datetime.combine(target_date, datetime.time(9, 15))
        end_dt = datetime.datetime.combine(target_date, datetime.time(15, 30))
        interval = '5minute'
        
        # Fetch target date candles
        target_candles = []
        try:
            hist = execute_with_retries(
                f"fetching {interval} historical data for token {instrument_token} on {target_date}",
                lambda: kite.historical_data(instrument_token, start_dt, end_dt, interval)
            )
            if hist:
                target_candles.extend(hist)
        except kite_exceptions.TokenException:
            raise
        except Exception as e:
            logging.warning(f"Historical fetch failed for {target_date}: {e}")
        
        if len(target_candles) < 10:
            return jsonify({'status': 'error', 'message': f'Insufficient data for {target_date}. Market may be closed.'}), 400

        # Fetch prior days for lookback context (need at least lookback candles before target date)
        prior_days = max(7, (lookback // 75) + 2)  # Estimate: ~75 candles per day
        all_candles = []
        current_date = target_date - datetime.timedelta(days=prior_days)
        while current_date <= target_date:
            start_d = datetime.datetime.combine(current_date, datetime.time(9, 15))
            end_d = datetime.datetime.combine(current_date, datetime.time(15, 30))
            try:
                hist = execute_with_retries(
                    f"fetching {interval} historical data for token {instrument_token} on {current_date}",
                    lambda: kite.historical_data(instrument_token, start_d, end_d, interval)
                )
                if hist:
                    all_candles.extend(hist)
            except kite_exceptions.TokenException:
                raise
            except Exception as e:
                logging.warning(f"Historical fetch failed for {current_date}: {e}")
            current_date += datetime.timedelta(days=1)

        if len(all_candles) < (lookback + 10):
            return jsonify({'status': 'error', 'message': 'Insufficient historical data for lookback'}), 400

        # Prepare features
        df = candles_to_dataframe(all_candles)
        scaler, scaled = prepare_training_data(df, lookback)

        # Load or train model
        model_dir = os.path.join(os.path.dirname(__file__), 'models')
        try:
            _ = load_model_and_predict(
                model_dir=model_dir,
                symbol=symbol,
                candles=all_candles[-max(len(all_candles), lookback+1):],
                horizon=horizon,
                lookback=lookback,
                steps_ahead=1,
            )
        except Exception:
            logging.info("[AIML] Model unavailable for date evaluation; training quick model...")
            _ = train_lstm_on_candles(
                candles=all_candles,
                model_dir=model_dir,
                symbol=symbol,
                lookback=lookback,
                horizon=horizon,
                epochs=10,
                batch_size=128,
            )

        model, _ = load_lstm_checkpoint(model_dir, symbol, horizon)
        device = next(model.parameters()).device

        # Filter to target date only
        df_target = df[df.index.date == target_date].copy()
        if len(df_target) == 0:
            return jsonify({'status': 'error', 'message': f'No data found for {target_date}'}), 400

        # Find indices in full dataset for target date
        target_start_idx = df.index.get_indexer([df_target.index[0]], method='nearest')[0]
        if target_start_idx < lookback:
            return jsonify({'status': 'error', 'message': 'Insufficient prior data for lookback'}), 400

        # Build sequences for target date only
        series = []
        feature_dim = scaled.shape[1]
        for i in range(target_start_idx, min(target_start_idx + len(df_target) - horizon + 1, len(scaled) - horizon + 1)):
            if i < lookback:
                continue
            X_seq = scaled[i-lookback:i, :].reshape(1, lookback, feature_dim)
            y_actual_scaled = scaled[i + horizon - 1, 0]
            with torch.no_grad():
                tensor_seq = torch.from_numpy(X_seq).float().to(device)
                y_pred_scaled = float(model(tensor_seq).cpu().numpy()[0][0])
            
            # Inverse transform
            row_a = np.zeros((feature_dim,)); row_a[0] = y_actual_scaled
            row_p = np.zeros((feature_dim,)); row_p[0] = y_pred_scaled
            actual_price = float(scaler.inverse_transform(row_a.reshape(1,-1))[0][0])
            pred_price = float(scaler.inverse_transform(row_p.reshape(1,-1))[0][0])
            
            # Format time as HH:MM (datetimes are already in IST after candles_to_dataframe conversion)
            dt = df.index[i + horizon - 1]
            # Datetime should already be IST (naive) from candles_to_dataframe
            time_str = dt.strftime('%H:%M')
            
            series.append({
                'time': time_str,
                'timeFull': dt.isoformat() if hasattr(dt, 'isoformat') else str(dt),
                'actual': actual_price,
                'predicted': pred_price,
            })

        return jsonify({
            'status': 'ok',
            'symbol': symbol,
            'date': date_str,
            'horizon': horizon,
            'series': series
        })
    except kite_exceptions.TokenException as e:
        logging.error(f"Error in api_aiml_evaluate_date due to invalid session: {e}")
        return jsonify({'status': 'error', 'message': 'Zerodha session expired. Please login again.'}), 401
    except Exception as e:
        logging.error(f"Error in api_aiml_evaluate_date: {e}", exc_info=True)
        return jsonify({'status': 'error', 'message': str(e)}), 500


@app.route('/aiml/evaluate_date', methods=['GET'])
def api_aiml_evaluate_date_compat():
    return api_aiml_evaluate_date()


# ========================= Live Trade Management =========================
@app.route("/api/live_trade/status", methods=['GET'])
def api_live_trade_status():
    if 'user_id' not in session:
        return jsonify({'status': 'error', 'message': 'User not logged in'}), 401

    deployment = live_get_deployment_for_user(session['user_id'])
    return jsonify({
        'status': 'success',
        'deployment': _serialize_live_deployment(deployment)
    })


@app.route("/api/live_trade/preview", methods=['POST'])
def api_live_trade_preview():
    if 'user_id' not in session:
        return jsonify({'status': 'error', 'message': 'User not logged in'}), 401
    if 'access_token' not in session:
        return jsonify({'status': 'error', 'message': 'Zerodha access token missing. Please login with Zerodha first.'}), 401

    data = request.get_json() or {}
    strategy_id_raw = data.get('strategy_id')
    lot_count_raw = data.get('lot_count', 1)

    try:
        lot_count = int(lot_count_raw)
    except (TypeError, ValueError):
        return jsonify({'status': 'error', 'message': 'Invalid lot count.'}), 400
    if lot_count <= 0:
        return jsonify({'status': 'error', 'message': 'Lot count must be greater than zero.'}), 400

    if strategy_id_raw is None:
        return jsonify({'status': 'error', 'message': 'Strategy identifier required.'}), 400

    try:
        strategy_id = int(strategy_id_raw)
    except (TypeError, ValueError):
        return jsonify({'status': 'error', 'message': 'Invalid strategy identifier.'}), 400

    strategy_row = _get_strategy_record_for_preview(strategy_id, session['user_id'])
    if not strategy_row:
        return jsonify({'status': 'error', 'message': 'Strategy not found for this user.'}), 404

    user_row = _get_user_record(session['user_id'])
    if not user_row:
        return jsonify({'status': 'error', 'message': 'User record not found.'}), 400

    user = dict(user_row)
    api_key = user.get('app_key')
    if not api_key:
        return jsonify({'status': 'error', 'message': 'Zerodha API key not configured for this user.'}), 400

    try:
        kite_client = KiteConnect(api_key=api_key)
        kite_client.set_access_token(session['access_token'])
        preview = preview_option_trade(kite_client, strategy_row, lot_count)
    except Exception as exc:
        logging.exception("Margin preview failed")
        return jsonify({'status': 'error', 'message': f'Unable to compute margin preview: {exc}'}), 500

    return jsonify({
        'status': 'success',
        'preview': {
            **preview,
            'stopLossPercentDisplay': abs(preview['stopLossPercent']) * 100,
            'targetPercentDisplay': abs(preview['targetPercent']) * 100,
        }
    })


@app.route("/api/live_trade/preview_order", methods=['POST'])
def api_live_trade_preview_order():
    if 'user_id' not in session:
        return jsonify({'status': 'error', 'message': 'User not logged in'}), 401
    if 'access_token' not in session:
        return jsonify({'status': 'error', 'message': 'Zerodha access token missing. Please login with Zerodha first.'}), 401

    data = request.get_json() or {}
    strategy_id_raw = data.get('strategy_id')
    lot_count_raw = data.get('lot_count', 1)
    order_type = (data.get('order_type') or 'ENTRY').upper()

    if order_type not in {'ENTRY', 'EXIT'}:
        return jsonify({'status': 'error', 'message': 'order_type must be ENTRY or EXIT'}), 400

    try:
        lot_count = int(lot_count_raw)
    except (TypeError, ValueError):
        return jsonify({'status': 'error', 'message': 'Invalid lot count.'}), 400
    if lot_count <= 0:
        return jsonify({'status': 'error', 'message': 'Lot count must be greater than zero.'}), 400

    if strategy_id_raw is None:
        return jsonify({'status': 'error', 'message': 'Strategy identifier required.'}), 400
    try:
        strategy_id = int(strategy_id_raw)
    except (TypeError, ValueError):
        return jsonify({'status': 'error', 'message': 'Invalid strategy identifier.'}), 400

    strategy_row = _get_strategy_record_for_preview(strategy_id, session['user_id'])
    if not strategy_row:
        return jsonify({'status': 'error', 'message': 'Strategy not found for this user.'}), 404

    user_row = _get_user_record(session['user_id'])
    if not user_row:
        return jsonify({'status': 'error', 'message': 'User record not found.'}), 400

    user = dict(user_row)
    api_key = user.get('app_key')
    if not api_key:
        return jsonify({'status': 'error', 'message': 'Zerodha API key not configured for this user.'}), 400

    try:
        kite_client = KiteConnect(api_key=api_key)
        kite_client.set_access_token(session['access_token'])
        preview = preview_option_trade(kite_client, strategy_row, lot_count)
        order_result = place_preview_order(kite_client, preview, order_type)
    except Exception as exc:
        logging.exception("Preview order failed")
        return jsonify({'status': 'error', 'message': f'Order failed: {exc}'}), 500

    return jsonify({
        'status': 'success',
        'order': order_result,
        'preview': preview,
    })


@app.route("/api/live_trade/deploy", methods=['POST'])
def api_live_trade_deploy():
    if 'user_id' not in session:
        return jsonify({'status': 'error', 'message': 'User not logged in'}), 401
    if 'access_token' not in session:
        return jsonify({'status': 'error', 'message': 'Zerodha access token missing. Please login with Zerodha first.'}), 401

    data = request.get_json() or {}
    strategy_id_raw = data.get('strategy_id')
    lot_count_raw = data.get('lot_count', 1)
    scheduled_start_raw = data.get('scheduled_start')

    try:
        lot_count = int(lot_count_raw)
    except (TypeError, ValueError):
        return jsonify({'status': 'error', 'message': 'Invalid lot count.'}), 400
    if lot_count <= 0:
        return jsonify({'status': 'error', 'message': 'Lot count must be greater than zero.'}), 400

    scheduled_start_dt: Optional[datetime.datetime] = None
    if scheduled_start_raw:
        try:
            scheduled_start_dt = ensure_datetime(scheduled_start_raw)
        except Exception:
            return jsonify({'status': 'error', 'message': 'Invalid scheduled start datetime.'}), 400

    user_id = session['user_id']

    existing = live_get_deployment_for_user(user_id)
    if existing and existing.get('status') not in {STATUS_STOPPED}:
        return jsonify({
            'status': 'error',
            'message': 'An existing deployment is already active. Please stop it before deploying again.'
        }), 400

    user_row = _get_user_record(user_id)
    if not user_row:
        return jsonify({'status': 'error', 'message': 'User record not found.'}), 400

    user = dict(user_row)
    api_key = user.get('app_key')
    if not api_key:
        return jsonify({'status': 'error', 'message': 'Zerodha API key not configured for this user.'}), 400

    strategy_id: Optional[int] = None
    strategy_name = 'Ad-hoc Strategy'
    strategy_row = None
    if strategy_id_raw is None:
        return jsonify({'status': 'error', 'message': 'Strategy identifier required.'}), 400
    try:
        strategy_id = int(strategy_id_raw)
    except (TypeError, ValueError):
        return jsonify({'status': 'error', 'message': 'Invalid strategy identifier.'}), 400
    strategy_row = _get_strategy_record_for_deploy(strategy_id, user_id)
    if not strategy_row:
        return jsonify({'status': 'error', 'message': 'Strategy not found or not deployable.'}), 404
    strategy = dict(strategy_row)
    strategy_name = strategy.get('strategy_name') or f"Strategy #{strategy_id}"

    access_token = session['access_token']
    preview: Optional[Dict[str, Any]] = None
    try:
        kite_client = KiteConnect(api_key=api_key)
        kite_client.set_access_token(access_token)
        preview = preview_option_trade(kite_client, strategy_row, lot_count)
        margins = execute_with_retries(
            "fetching Kite margins during live deployment",
            lambda: kite_client.margins()
        )
        available_cash = None
        available_intraday = None
        total_available = None
        if isinstance(margins, dict):
            equity = margins.get('equity') or {}
            available_dict = equity.get('available') or {}
            live_balance = available_dict.get('live_balance')
            available_cash = available_dict.get('cash')
            available_intraday = available_dict.get('intraday')

            if live_balance is not None:
                total_available = float(live_balance)
            else:
                total_available = 0.0
                if available_cash is not None:
                    total_available += float(available_cash)
                if available_intraday is not None:
                    total_available += float(available_intraday)
        available_float = float(total_available or 0.0)
        if available_float <= 0 or preview['requiredCapital'] > available_float:
            return jsonify({
                'status': 'error',
                'message': f'Insufficient margin. Required ₹{preview["requiredCapital"]:.2f}, Available ₹{available_float:.2f}',
                'margins': margins,
            }), 400
    except Exception as exc:
        logging.exception("Failed to validate margins for live trade deployment")
        return jsonify({'status': 'error', 'message': f'Unable to validate Zerodha margin: {exc}'}), 500

    now = datetime.datetime.now(datetime.timezone.utc)
    status = STATUS_ACTIVE
    phase = 'initializing'
    message = 'Deployment activated immediately.'
    if scheduled_start_dt and scheduled_start_dt > now:
        status = STATUS_SCHEDULED
        phase = 'scheduled'
        message = f'Deployment scheduled for {scheduled_start_dt.isoformat()}'

    state = {
        'phase': phase,
        'message': message,
        'lastCheck': now.isoformat(),
        'orders': [],
        'positions': [],
        'margin': {
            'availableCash': available_float,
            'requiredCapital': preview['requiredCapital'],
            'snapshot': margins if isinstance(margins, dict) else None,
        },
        'livePnl': 0.0,
        'history': [
            {
                'timestamp': now.isoformat(),
                'level': 'info',
                'message': 'Deployment created by user.',
            }
        ],
        'config': {
            'lotCount': lot_count,
            'lotSize': preview['lotSize'],
            'totalQuantity': preview['totalQuantity'],
            'optionSymbol': preview['optionSymbol'],
            'stopLossPercent': preview['stopLossPercent'],
            'targetPercent': preview['targetPercent'],
            'evaluationSecondsBeforeClose': preview.get('evaluationSecondsBeforeClose', 20),
            'candleIntervalMinutes': preview.get('candleIntervalMinutes', 5),
            'rsiThreshold': preview.get('rsiThreshold', 70),
        }
    }

    deployment = live_create_deployment(
        user_id=user_id,
        strategy_id=strategy_id,
        strategy_name=strategy_name,
        initial_investment=preview['requiredCapital'],
        scheduled_start=scheduled_start_dt,
        status=status,
        kite_access_token=access_token,
        state=state,
        started_at=None if status != STATUS_ACTIVE else now,
    )

    if deployment and status == STATUS_ACTIVE:
        try:
            _ensure_live_strategy_monitor(
                user_id,
                deployment['id'],
                strategy_row,
                access_token=access_token,
                config=state.get('config'),
                lot_count=lot_count,
            )
        except Exception:
            logging.exception("Failed to initialize live strategy monitor for deployment %s", deployment.get('id'))

    return jsonify({
        'status': 'success',
        'deployment': _serialize_live_deployment(deployment)
    })


@app.route("/api/live_trade/pause", methods=['POST'])
def api_live_trade_pause():
    if 'user_id' not in session:
        return jsonify({'status': 'error', 'message': 'User not logged in'}), 401

    deployment = live_get_deployment_for_user(session['user_id'])
    if not deployment:
        return jsonify({'status': 'error', 'message': 'No deployment found to pause.'}), 404

    if deployment.get('status') == STATUS_PAUSED:
        return jsonify({'status': 'success', 'deployment': _serialize_live_deployment(deployment)})

    now = datetime.datetime.now(datetime.timezone.utc)
    state = deployment.get('state') or {}
    state.update({
        'phase': 'paused',
        'message': 'Deployment paused by user.',
        'lastCheck': now.isoformat(),
    })

    updated = live_update_deployment(
        deployment['id'],
        status=STATUS_PAUSED,
        state=state,
        last_run_at=now,
        error_message=None
    )

    return jsonify({'status': 'success', 'deployment': _serialize_live_deployment(updated)})


@app.route("/api/live_trade/resume", methods=['POST'])
def api_live_trade_resume():
    if 'user_id' not in session:
        return jsonify({'status': 'error', 'message': 'User not logged in'}), 401

    deployment = live_get_deployment_for_user(session['user_id'])
    if not deployment:
        return jsonify({'status': 'error', 'message': 'No deployment found to resume.'}), 404

    if deployment.get('status') == STATUS_ACTIVE:
        return jsonify({'status': 'success', 'deployment': _serialize_live_deployment(deployment)})

    now = datetime.datetime.now(datetime.timezone.utc)
    state = deployment.get('state') or {}
    state.update({
        'phase': 'resuming',
        'message': 'Deployment resume requested by user.',
        'lastCheck': now.isoformat(),
    })

    updated = live_update_deployment(
        deployment['id'],
        status=STATUS_ACTIVE,
        state=state,
        last_run_at=now,
        started_at=deployment.get('started_at') or now,
        error_message=None
    )

    try:
        strategy_row = _get_strategy_record(updated.get('strategy_id'), session['user_id'])
        access_token = updated.get('kite_access_token') or session.get('access_token')
        if strategy_row and access_token:
            _ensure_live_strategy_monitor(
                session['user_id'],
                updated['id'],
                strategy_row,
                access_token=access_token,
                config=(updated.get('state') or {}).get('config'),
            )
    except Exception:
        logging.exception("Failed to reinitialize live strategy monitor during resume for deployment %s", updated.get('id'))

    return jsonify({'status': 'success', 'deployment': _serialize_live_deployment(updated)})


@app.route("/api/live_trade/stop", methods=['POST'])
def api_live_trade_stop():
    if 'user_id' not in session:
        return jsonify({'status': 'error', 'message': 'User not logged in'}), 401

    deployment = live_get_deployment_for_user(session['user_id'])
    if not deployment:
        return jsonify({'status': 'error', 'message': 'No deployment found to stop.'}), 404

    now = datetime.datetime.now(datetime.timezone.utc)
    state = deployment.get('state') or {}
    state.update({
        'phase': 'stopped',
        'message': 'Deployment stopped by user.',
        'lastCheck': now.isoformat(),
    })

    updated = live_update_deployment(
        deployment['id'],
        status=STATUS_STOPPED,
        state=state,
        last_run_at=now,
        error_message=None
    )

    for run_id, info in list(running_strategies.items()):
        if info.get('live_deployment_id') == deployment['id']:
            del running_strategies[run_id]

    return jsonify({'status': 'success', 'deployment': _serialize_live_deployment(updated)})


@app.route("/api/live_trade/square_off", methods=['POST'])
def api_live_trade_square_off():
    if 'user_id' not in session:
        return jsonify({'status': 'error', 'message': 'User not logged in'}), 401

    payload = request.get_json(silent=True) or {}
    target_symbol = (payload.get('tradingsymbol') or '').strip().upper()
    target_exchange = (payload.get('exchange') or '').strip().upper()

    deployment = live_get_deployment_for_user(session['user_id'])
    if not deployment:
        return jsonify({'status': 'error', 'message': 'No deployment found to square off.'}), 404

    user_row = _get_user_record(session['user_id'])
    if not user_row:
        return jsonify({'status': 'error', 'message': 'User record not found.'}), 400

    user = dict(user_row)
    api_key = user.get('app_key')
    if not api_key:
        return jsonify({'status': 'error', 'message': 'Zerodha API key not configured for this user.'}), 400

    try:
        def _prepare_client(client: KiteConnect) -> KiteConnect:
            execute_with_retries(
                "validating Zerodha session before square-off",
                lambda: client.profile()
            )
            return client

        token_candidates: List[str] = []
        deployment_token = deployment.get('kite_access_token')
        if deployment_token:
            token_candidates.append(deployment_token)
        if has_request_context():
            try:
                session_token = session.get('access_token')
                if session_token:
                    token_candidates.append(session_token)
            except Exception:
                pass

        kite_client: KiteConnect = _with_valid_kite_client(
            session['user_id'],
            "live trade square-off",
            _prepare_client,
            preferred_tokens=token_candidates
        )
    except kite_exceptions.TokenException:
        return jsonify({'status': 'error', 'message': 'Zerodha session expired. Please login again.', 'authExpired': True}), 401
    except RuntimeError as exc:
        return jsonify({'status': 'error', 'message': str(exc)}), 400
    except Exception as exc:
        logging.exception("Unexpected error preparing Kite client for square-off")
        return jsonify({'status': 'error', 'message': f'Unable to prepare Zerodha client: {exc}'}), 500

    try:
        positions = execute_with_retries(
            "fetching Kite positions during square off",
            lambda: kite_client.positions()
        )
    except kite_exceptions.TokenException as exc:
        logging.error("Square-off failed during positions fetch: %s", exc)
        return jsonify({'status': 'error', 'message': 'Zerodha session expired. Please login again.', 'authExpired': True}), 401
    except Exception as exc:
        logging.exception("Failed to fetch positions during square off")
        return jsonify({'status': 'error', 'message': f'Failed to fetch positions: {exc}'}), 500

    net_positions = positions.get('net', []) if isinstance(positions, dict) else []
    if target_symbol:
        net_positions = [
            pos for pos in net_positions
            if str(pos.get('tradingsymbol', '')).upper() == target_symbol and
               (not target_exchange or str(pos.get('exchange', '')).upper() == target_exchange)
        ]
    exit_results = []

    for pos in net_positions:
        qty = pos.get('quantity')
        if not qty:
            continue

        tradingsymbol = pos.get('tradingsymbol')
        exchange = pos.get('exchange') or 'NFO'
        product = pos.get('product') or kite_client.PRODUCT_MIS
        exit_qty = abs(int(qty))
        transaction_type = (
            kite_client.TRANSACTION_TYPE_SELL if qty > 0 else kite_client.TRANSACTION_TYPE_BUY
        )

        try:
            open_orders = execute_with_retries(
                f"fetching open orders before square off for {tradingsymbol}",
                lambda: kite_client.orders()
            )
        except Exception as exc:
            logging.warning("Unable to fetch open orders for %s prior to square-off: %s", tradingsymbol, exc)
            open_orders = []

        protective_orders = []
        for order in open_orders:
            if str(order.get('tradingsymbol', '')).upper() != str(tradingsymbol).upper():
                continue
            status = order.get('status', '').upper()
            if status not in ('OPEN', 'TRIGGER PENDING', 'OPEN PENDING', 'VALIDATION PENDING'):
                continue
            if order.get('product') != product:
                continue
            if order.get('transaction_type') == transaction_type:
                continue
            protective_orders.append(order)

        for order in protective_orders:
            order_id = order.get('order_id')
            if not order_id:
                continue
            variety = order.get('variety') or kite_client.VARIETY_REGULAR
            try:
                if order.get('order_type') in (kite_client.ORDER_TYPE_SL, kite_client.ORDER_TYPE_SLM, 'SL', 'SLM'):
                    try:
                        kite_client.modify_order(
                            variety=variety,
                            order_id=order_id,
                            order_type=kite_client.ORDER_TYPE_MARKET,
                            price=0,
                            trigger_price=None,
                            quantity=order.get('quantity')
                        )
                        status_after = _wait_for_order_completion(kite_client, order_id, timeout=20)
                        logging.info("Modified protective order %s to MARKET, status=%s", order_id, status_after)
                        if status_after == 'COMPLETE':
                            exit_results.append({
                                'tradingsymbol': tradingsymbol,
                                'quantity': int(order.get('quantity') or 0),
                                'status': 'protective_exit',
                                'order_id': order_id
                            })
                            exit_qty = max(0, exit_qty - int(order.get('quantity') or 0))
                            continue
                    except Exception as exc:
                        logging.warning("Failed to modify protective order %s to market: %s", order_id, exc)
                kite_client.cancel_order(variety=variety, order_id=order_id)
                cancel_status = _wait_for_order_completion(kite_client, order_id, timeout=20)
                logging.info("Cancelled protective order %s, status=%s", order_id, cancel_status)
            except Exception as exc:
                logging.warning("Could not modify/cancel protective order %s: %s", order_id, exc)

        if exit_qty == 0:
            continue

        try:
            order_id = kite_client.place_order(
                variety=kite_client.VARIETY_REGULAR,
                exchange=exchange,
                tradingsymbol=tradingsymbol,
                transaction_type=transaction_type,
                quantity=exit_qty,
                product=product,
                order_type=kite_client.ORDER_TYPE_MARKET,
                validity=kite_client.VALIDITY_DAY
            )
            final_status = _wait_for_order_completion(kite_client, order_id, timeout=30)
            exit_results.append({
                'tradingsymbol': tradingsymbol,
                'quantity': exit_qty,
                'status': final_status.lower() if isinstance(final_status, str) else 'placed',
                'order_id': order_id
            })
        except Exception as exc:
            logging.exception("Square-off order failed for %s", tradingsymbol)
            exit_results.append({
                'tradingsymbol': tradingsymbol,
                'quantity': exit_qty,
                'status': 'error',
                'message': str(exc)
            })

    now = datetime.datetime.now(datetime.timezone.utc)
    state = deployment.get('state') or {}
    state.update({
        'phase': 'square_off',
        'message': 'Square-off initiated. Review order statuses for confirmation.',
        'lastCheck': now.isoformat(),
        'squareOff': exit_results,
    })

    updated = live_update_deployment(
        deployment['id'],
        status=deployment.get('status', STATUS_ACTIVE),
        state=state,
        last_run_at=now
    )

    return jsonify({
        'status': 'success',
        'deployment': _serialize_live_deployment(updated),
        'results': exit_results
    })


@app.route("/api/live_trade/delete", methods=['DELETE', 'OPTIONS'])
def api_live_trade_delete():
    if request.method == 'OPTIONS':
        return jsonify({'status': 'success'}), 200
    if 'user_id' not in session:
        return jsonify({'status': 'error', 'message': 'User not logged in'}), 401

    deployment = live_get_deployment_for_user(session['user_id'])
    if not deployment:
        return jsonify({'status': 'success', 'message': 'No deployment to delete.'})

    for run_id, info in list(running_strategies.items()):
        if info.get('live_deployment_id') == deployment['id']:
            del running_strategies[run_id]

    live_delete_deployment(deployment['id'])
    return jsonify({'status': 'success', 'message': 'Deployment deleted.'})


# ========================= Reinforcement Learning =========================
@app.route('/api/rl/status', methods=['GET'])
def api_rl_status():
    """Check RL module availability"""
    # List all RL routes for debugging
    rl_routes = [str(rule) for rule in app.url_map.iter_rules() if 'rl' in str(rule)]
    return jsonify({
        'status': 'ok',
        'rl_available': RL_AVAILABLE,
        'message': 'RL module available' if RL_AVAILABLE else 'RL module not available. TensorFlow required.',
        'registered_routes': rl_routes
    })

@app.route('/api/rl/train', methods=['GET', 'POST', 'OPTIONS'])
def api_rl_train():
    """Train RL agent on historical data"""
    # Handle CORS preflight
    if request.method == 'OPTIONS':
        response = jsonify({'status': 'ok'})
        return response
    
    # Allow GET for testing
    if request.method == 'GET':
        return jsonify({
            'status': 'ok',
            'message': 'RL train endpoint is accessible. Use POST to train.',
            'rl_available': RL_AVAILABLE
        })
    
    logging.info(f"[RL] Train endpoint called, RL_AVAILABLE={RL_AVAILABLE}, method={request.method}, path={request.path}")
    if not RL_AVAILABLE:
        return jsonify({'status': 'error', 'message': 'RL module not available. TensorFlow required.'}), 503
    try:
        data = request.get_json(force=True) if request.is_json else request.form
        symbol = (data.get('symbol') or 'BANKNIFTY').upper()
        years = int(data.get('years', 3))
        episodes = int(data.get('episodes', 100))
        epsilon = float(data.get('epsilon', 1.0))
        epsilon_decay = float(data.get('epsilon_decay', 0.995))
        train_start_raw = data.get('train_start')
        train_end_raw = data.get('train_end')
        train_start = _parse_iso_date(train_start_raw)
        train_end = _parse_iso_date(train_end_raw)
        
        token_map = {'NIFTY': 256265, 'BANKNIFTY': 260105}
        if symbol not in token_map:
            return jsonify({'status': 'error', 'message': 'Unsupported symbol. Use NIFTY or BANKNIFTY'}), 400
        instrument_token = token_map[symbol]
        
        if train_start and train_end:
            if train_end < train_start:
                return jsonify({'status': 'error', 'message': 'train_end cannot be before train_start'}), 400
            start_date = train_start
            end_date = train_end
            logging.info(f"[RL] Training request: symbol={symbol}, train_start={start_date}, train_end={end_date}, episodes={episodes}")
            print(f"[RL] Training request: symbol={symbol}, train_start={start_date}, train_end={end_date}, episodes={episodes}", flush=True)
        else:
            end_date = datetime.date.today()
            start_date = end_date - datetime.timedelta(days=365 * years)
            logging.info(f"[RL] Training request: symbol={symbol}, years={years}, episodes={episodes}")
            print(f"[RL] Training request: symbol={symbol}, years={years}, episodes={episodes}", flush=True)
        
        all_candles = _fetch_candles_for_range(instrument_token, start_date, end_date, interval='5minute')
        
        if len(all_candles) < 1000:
            return jsonify({'status': 'error', 'message': 'Insufficient data for RL training'}), 400
        
        # Train RL agent
        model_dir = os.path.join(os.path.dirname(__file__), 'models')
        logging.info(f"[RL] Starting RL training on {len(all_candles)} candles with episodes={episodes}, epsilon={epsilon}, epsilon_decay={epsilon_decay}...")
        training_start_time = datetime.datetime.now()
        result = train_rl_agent(
            candles=all_candles,
            symbol=symbol,
            model_dir=model_dir,
            episodes=episodes,
            epsilon=epsilon,
            epsilon_decay=epsilon_decay,
        )
        duration = (datetime.datetime.now() - training_start_time).total_seconds()
        logging.info(f"[RL] Training complete in {duration:.2f}s. Model saved to {result.get('model_path')}")
        return jsonify({
            'status': 'ok',
            'symbol': symbol,
            'train_start': start_date.isoformat(),
            'train_end': end_date.isoformat(),
            **result
        })
    except Exception as e:
        logging.error(f"Error in api_rl_train: {e}", exc_info=True)
        return jsonify({'status': 'error', 'message': str(e)}), 500


@app.route('/api/rl/evaluate', methods=['GET'])
def api_rl_evaluate():
    """Evaluate trained RL agent on test data"""
    if not RL_AVAILABLE:
        return jsonify({'status': 'error', 'message': 'RL module not available. TensorFlow required.'}), 503
    try:
        symbol = (request.args.get('symbol') or 'BANKNIFTY').upper()
        years = float(request.args.get('years', 0.5))  # Last 6 months for evaluation
        eval_start_raw = request.args.get('start')
        eval_end_raw = request.args.get('end')
        eval_label = request.args.get('label')
        eval_start = _parse_iso_date(eval_start_raw)
        eval_end = _parse_iso_date(eval_end_raw)
        
        token_map = {'NIFTY': 256265, 'BANKNIFTY': 260105}
        if symbol not in token_map:
            return jsonify({'status': 'error', 'message': 'Unsupported symbol. Use NIFTY or BANKNIFTY'}), 400
        instrument_token = token_map[symbol]
        
        if eval_start and eval_end:
            if eval_end < eval_start:
                return jsonify({'status': 'error', 'message': 'end date cannot be before start date'}), 400
            start_date = eval_start
            end_date = eval_end
        else:
            end_date = datetime.date.today()
            start_date = end_date - datetime.timedelta(days=int(365 * years))
        
        all_candles = _fetch_candles_for_range(instrument_token, start_date, end_date, interval='5minute')
        
        if len(all_candles) < 100:
            return jsonify({'status': 'error', 'message': 'Insufficient test data'}), 400
        
        # Evaluate RL agent
        model_dir = os.path.join(os.path.dirname(__file__), 'models')
        result = evaluate_rl_agent(
            candles=all_candles,
            symbol=symbol,
            model_dir=model_dir,
        )
        payload = {
            'status': 'ok',
            'symbol': symbol,
            'period': f"{start_date.isoformat()} → {end_date.isoformat()}",
            'label': eval_label or ('custom' if eval_start and eval_end else 'rolling'),
            'pnl': result.get('total_pnl'),
            'wins': result.get('winning_trades'),
            'losses': result.get('losing_trades'),
            'win_rate': result.get('win_rate'),
            'avg_win': result.get('avg_win'),
            'avg_loss': result.get('avg_loss'),
            'trade_history': result.get('trade_history', []),  # Enhanced with detailed explanations
            'decision_log': result.get('decision_log', []),  # Model decision explanations
            'actions_taken': result.get('actions_taken'),
            'final_balance': result.get('final_balance'),
            'total_trades': result.get('total_trades'),
            'series': result.get('series', []),
            'split_index': result.get('split_index', 0),
            'initial_balance': result.get('initial_balance'),
            'drawdown_series': result.get('drawdown_series', []),
            'trade_points': result.get('trade_points', []),
            'max_drawdown_abs': result.get('max_drawdown_abs'),
            'start_date': start_date.isoformat(),
            'end_date': end_date.isoformat(),
        }
        return jsonify(payload)
    except Exception as e:
        logging.error(f"Error in api_rl_evaluate: {e}", exc_info=True)
        return jsonify({'status': 'error', 'message': str(e)}), 500


@app.route('/aiml/rl/train', methods=['POST'])
def api_rl_train_compat():
    return api_rl_train()


@app.route('/aiml/rl/evaluate', methods=['GET'])
def api_rl_evaluate_compat():
    return api_rl_evaluate()


@app.route('/aiml/rl/status', methods=['GET'])
def api_rl_status_compat():
    return api_rl_status()


app.register_blueprint(chat_bp)

# Log all registered routes on startup (for debugging)
def log_routes():
    """Log all registered routes for debugging"""
    try:
        routes = []
        for rule in app.url_map.iter_rules():
            routes.append(f"{', '.join(rule.methods)} {rule.rule}")
        logging.info(f"Registered {len(routes)} routes")
        rl_routes = [r for r in routes if 'rl' in r.lower()]
        if rl_routes:
            logging.info(f"RL routes: {rl_routes}")
    except Exception as e:
        logging.warning(f"Could not log routes: {e}")

# Log routes after all blueprints are registered
log_routes()

if __name__ == "__main__":
    logging.info("=" * 60)
    logging.info(f"Starting Flask server on {config.SERVER_HOST}:{config.SERVER_PORT}")
    logging.info(f"Debug mode: {config.DEBUG}")
    logging.info(f"RL module available: {RL_AVAILABLE}")
    logging.info("=" * 60)
    try:
        # Use socketio.run() which properly handles Socket.IO paths
        # This is critical - don't use app.run() when using Socket.IO
        socketio.run(
            app,
            debug=config.DEBUG,
            host=config.SERVER_HOST,
            port=config.SERVER_PORT,
            allow_unsafe_werkzeug=True,
            use_reloader=False  # Disable reloader to avoid issues with eventlet
        )
    except Exception as e:
        logging.error(f"Failed to start server: {e}", exc_info=True)
        raise