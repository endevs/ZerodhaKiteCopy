import os
import json
import math
import pickle
import datetime
import logging
from typing import Tuple, Dict, Any, List

import numpy as np
import pandas as pd
import torch
from torch import nn
from torch.utils.data import DataLoader, TensorDataset

from sklearn.preprocessing import MinMaxScaler


DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
if torch.cuda.is_available():
    torch.backends.cuda.matmul.allow_tf32 = True  # type: ignore[attr-defined]
    torch.backends.cudnn.allow_tf32 = True  # type: ignore[attr-defined]
print(f"[AIML] Torch device: {DEVICE}")

MODEL_HIDDEN_SIZE = 64
MODEL_NUM_LAYERS = 2
MODEL_DROPOUT = 0.2


class LSTMPriceModel(nn.Module):
    def __init__(self, input_dim: int, hidden_size: int = MODEL_HIDDEN_SIZE, num_layers: int = MODEL_NUM_LAYERS, dropout: float = MODEL_DROPOUT):
        super().__init__()
        self.lstm = nn.LSTM(
            input_size=input_dim,
            hidden_size=hidden_size,
            num_layers=num_layers,
            batch_first=True,
            dropout=dropout if num_layers > 1 else 0.0,
        )
        self.dropout = nn.Dropout(dropout)
        self.fc1 = nn.Linear(hidden_size, 32)
        self.act = nn.ReLU()
        self.fc2 = nn.Linear(32, 1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        out, _ = self.lstm(x)
        out = out[:, -1, :]
        out = self.dropout(out)
        out = self.act(self.fc1(out))
        return self.fc2(out)


def candles_to_dataframe(candles: List[Dict[str, Any]]) -> pd.DataFrame:
    """Convert Kite-like candles list to a DataFrame with datetime index.

    Expected item keys: date, open, high, low, close, volume
    """
    if not candles:
        return pd.DataFrame(columns=["open", "high", "low", "close", "volume"])
    df = pd.DataFrame(candles)
    # Normalize column names
    rename_map = {
        "Date": "date",
        "Open": "open",
        "High": "high",
        "Low": "low",
        "Close": "close",
        "Volume": "volume",
    }
    df = df.rename(columns=rename_map)
    # Parse datetime - handle timezone-aware datetimes from Zerodha
    if "date" in df.columns:
        # Convert to datetime - Zerodha returns timezone-aware datetimes
        df["date"] = pd.to_datetime(df["date"])
        # Remove timezone info (convert to naive datetime) - preserve IST time
        try:
            # If timezone-aware, convert to IST (Asia/Kolkata) then remove timezone to preserve IST time
            if df["date"].dt.tz is not None:
                # Convert to IST first, then remove timezone (this preserves the IST time)
                df["date"] = df["date"].dt.tz_convert('Asia/Kolkata').dt.tz_localize(None)
        except (AttributeError, TypeError, Exception):
            # Already naive or can't determine - check dtype string as fallback
            dtype_str = str(df["date"].dtype)
            if 'tz' in dtype_str.lower() or 'tzoffset' in dtype_str.lower():
                # Force conversion: assume UTC and convert to IST, then remove timezone
                try:
                    df["date"] = pd.to_datetime(df["date"], utc=True).dt.tz_convert('Asia/Kolkata').dt.tz_localize(None)
                except Exception:
                    # Fallback: just remove timezone (assume already IST)
                    df["date"] = pd.to_datetime(df["date"], utc=True).dt.tz_localize(None)
    df = df.set_index("date").sort_index()
    # Ensure numeric
    for col in ["open", "high", "low", "close", "volume"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    df = df.dropna(subset=["open", "high", "low", "close"]).copy()
    return df


def build_lstm_model(feature_dim: int) -> LSTMPriceModel:
    return LSTMPriceModel(input_dim=feature_dim)


def create_sequences(series: np.ndarray, lookback: int, horizon: int) -> Tuple[np.ndarray, np.ndarray]:
    """Create rolling window sequences for supervised learning.

    series: shape (N, features)
    Returns X shape (N-lookback-horizon+1, lookback, features), y shape (N-lookback-horizon+1,)
    """
    X, y = [], []
    total = series.shape[0]
    end = total - lookback - horizon + 1
    for i in range(end):
        X.append(series[i : i + lookback, :])
        # next horizon target uses close (assumed feature index 0 for close if we choose that)
        # We set target as close at t+lookback+horizon-1 using first column (close_scaled)
        y.append(series[i + lookback + horizon - 1, 0])
    return np.array(X), np.array(y)


def prepare_training_data(df: pd.DataFrame, lookback: int = 60) -> Tuple[MinMaxScaler, np.ndarray]:
    """Scale features and return scaled array with columns: close, open, high, low, volume."""
    features = df[["close", "open", "high", "low"]].copy()
    if "volume" in df.columns:
        features["volume"] = df["volume"].fillna(0)
    else:
        features["volume"] = 0.0
    scaler = MinMaxScaler()
    scaled = scaler.fit_transform(features.values)
    return scaler, scaled


def train_lstm_on_candles(
    candles: List[Dict[str, Any]],
    model_dir: str,
    symbol: str,
    lookback: int = 60,
    horizon: int = 1,
    epochs: int = 20,
    batch_size: int = 64,
) -> Dict[str, Any]:
    """Train LSTM on provided candles and save model + scaler.

    horizon: number of candles ahead (1-6)
    """
    os.makedirs(model_dir, exist_ok=True)
    df = candles_to_dataframe(candles)
    if len(df) < lookback + 10:
        raise ValueError("Not enough data to train. Need at least lookback + 10 candles.")

    scaler, scaled = prepare_training_data(df, lookback)
    logging.info(
        "[AIML][%s] Starting LSTM training | candles=%d | lookback=%d | horizon=%d | epochs=%d | batch_size=%d | device=%s",
        symbol,
        len(df),
        lookback,
        horizon,
        epochs,
        batch_size,
        DEVICE,
    )
    X, y = create_sequences(scaled, lookback, horizon)
    # Train/test split 70/30
    split_index = int(0.7 * len(X))
    X_train, y_train = X[:split_index], y[:split_index]
    X_test, y_test = X[split_index:], y[split_index:]

    model = build_lstm_model(X.shape[2]).to(DEVICE)
    criterion = nn.MSELoss()
    optimizer = torch.optim.Adam(model.parameters(), lr=1e-3)

    train_dataset = TensorDataset(
        torch.from_numpy(X_train).float(), torch.from_numpy(y_train).float()
    )
    train_loader = DataLoader(train_dataset, batch_size=max(1, batch_size), shuffle=True)

    val_loader = None
    if len(X_test) > 0:
        val_dataset = TensorDataset(
            torch.from_numpy(X_test).float(), torch.from_numpy(y_test).float()
        )
        val_loader = DataLoader(val_dataset, batch_size=max(1, batch_size), shuffle=False)

    history_loss: List[float] = []
    history_val_loss: List[float] = []

    for epoch in range(epochs):
        model.train()
        epoch_loss = 0.0
        total = 0
        for xb, yb in train_loader:
            xb = xb.to(DEVICE)
            yb = yb.to(DEVICE)
            optimizer.zero_grad()
            preds = model(xb).squeeze(-1)
            loss = criterion(preds, yb)
            loss.backward()
            optimizer.step()
            batch_size_curr = xb.size(0)
            epoch_loss += loss.item() * batch_size_curr
            total += batch_size_curr

        epoch_loss = epoch_loss / max(1, total)
        history_loss.append(float(epoch_loss))

        val_loss = None
        if val_loader is not None:
            model.eval()
            val_total = 0
            val_accum = 0.0
            with torch.no_grad():
                for xb, yb in val_loader:
                    xb = xb.to(DEVICE)
                    yb = yb.to(DEVICE)
                    preds = model(xb).squeeze(-1)
                    loss = criterion(preds, yb)
                    batch_size_curr = xb.size(0)
                    val_accum += loss.item() * batch_size_curr
                    val_total += batch_size_curr
            if val_total > 0:
                val_loss = val_accum / val_total
        history_val_loss.append(float(val_loss) if val_loss is not None else None)

        display_val = f"{val_loss:.6f}" if val_loss is not None else "N/A"
        print(f"[AIML][{symbol}] Epoch {epoch+1}/{epochs} - loss: {epoch_loss:.6f} - val_loss: {display_val}")

    eval_mse = history_val_loss[-1] if len(X_test) > 0 else None

    model_path = os.path.join(model_dir, f"{symbol}_lstm_h{horizon}.pt")
    scaler_path = os.path.join(model_dir, f"{symbol}_lstm_h{horizon}_scaler.pkl")
    torch.save(
        {
            "state_dict": model.state_dict(),
            "input_dim": X.shape[2],
            "hidden_size": MODEL_HIDDEN_SIZE,
            "num_layers": MODEL_NUM_LAYERS,
            "dropout": MODEL_DROPOUT,
        },
        model_path,
    )
    with open(scaler_path, "wb") as f:
        pickle.dump(scaler, f)

    return {
        "model_path": model_path,
        "scaler_path": scaler_path,
        "history": {
            "loss": [float(v) for v in history_loss],
            "val_loss": [
                float(v) if v is not None else None for v in history_val_loss
            ],
        },
        "test_mse": eval_mse,
        "samples_train": int(X_train.shape[0]),
        "samples_test": int(X_test.shape[0]),
    }


def load_lstm_checkpoint(model_dir: str, symbol: str, horizon: int) -> Tuple[LSTMPriceModel, Dict[str, Any]]:
    model_path_pt = os.path.join(model_dir, f"{symbol}_lstm_h{horizon}.pt")
    if not os.path.exists(model_path_pt):
        raise FileNotFoundError("Model not found. Train the model first.")
    checkpoint = torch.load(model_path_pt, map_location=DEVICE)
    input_dim = checkpoint.get("input_dim")
    if input_dim is None:
        raise RuntimeError(f"Checkpoint {model_path_pt} missing input_dim metadata")
    model = LSTMPriceModel(
        input_dim=input_dim,
        hidden_size=checkpoint.get("hidden_size", MODEL_HIDDEN_SIZE),
        num_layers=checkpoint.get("num_layers", MODEL_NUM_LAYERS),
        dropout=checkpoint.get("dropout", MODEL_DROPOUT),
    )
    model.load_state_dict(checkpoint["state_dict"])
    model.to(DEVICE)
    model.eval()
    return model, checkpoint


def load_model_and_predict(
    model_dir: str,
    symbol: str,
    candles: List[Dict[str, Any]],
    horizon: int = 1,
    lookback: int = 60,
    steps_ahead: int = 6,
) -> Dict[str, Any]:
    """Load model and generate iterative predictions up to steps_ahead (1-6 candles).

    Returns predicted closes (de-normalized) and basic confidence proxy using distance-based heuristic.
    """
    scaler_path = os.path.join(model_dir, f"{symbol}_lstm_h{horizon}_scaler.pkl")
    if not os.path.exists(scaler_path):
        raise FileNotFoundError("Model or scaler not found. Train the model first.")

    model, _ = load_lstm_checkpoint(model_dir, symbol, horizon)

    with open(scaler_path, "rb") as f:
        scaler: MinMaxScaler = pickle.load(f)

    df = candles_to_dataframe(candles)
    _, scaled = prepare_training_data(df, lookback)
    if scaled.shape[0] < lookback:
        raise ValueError("Not enough recent candles to seed prediction.")

    window = scaled[-lookback:, :].copy()
    preds_scaled: List[float] = []
    for _ in range(steps_ahead):
        X = window[np.newaxis, :, :]
        with torch.no_grad():
            tensor_x = torch.from_numpy(X).float().to(DEVICE)
            pred = model(tensor_x).cpu().numpy()[0][0]
        next_scaled_close = float(pred)
        preds_scaled.append(next_scaled_close)
        # Build next row using predicted close and hold other features as last observed
        last_row = window[-1, :].copy()
        new_row = last_row
        new_row[0] = next_scaled_close
        window = np.vstack([window[1:], new_row])

    # Inverse transform close only
    # To inverse_transform we need full-feature rows; create rows with predicted close and last observed for others
    last_row_full = scaled[-1, :]
    inv_preds = []
    for p in preds_scaled:
        row = last_row_full.copy()
        row[0] = p
        inv = scaler.inverse_transform(row.reshape(1, -1))[0][0]
        inv_preds.append(float(inv))

    # Confidence heuristic: compare last residual statistics on validation-like window
    recent_true = df["close"].values[-(lookback + steps_ahead) : -steps_ahead] if df.shape[0] >= (lookback + steps_ahead) else df["close"].values[-lookback:]
    recent_scaled = scaled[-len(recent_true) :, 0]
    # Higher stability (low std) => higher confidence
    stability = float(1.0 / (np.std(recent_scaled) + 1e-6))
    confidence = min(0.99, max(0.1, stability / 10.0))

    return {"predictions": inv_preds, "confidence": confidence}


