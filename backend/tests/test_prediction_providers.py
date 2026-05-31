"""Tests for isolated prediction providers."""
import os
import sys

_backend = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _backend not in sys.path:
    sys.path.insert(0, _backend)

from prediction_providers import (
    ProviderResult,
    build_warnings,
    compute_ensemble,
    has_any_prediction,
    pick_best_model,
    provider_map,
)


def test_compute_ensemble_requires_both():
    tf = [1.0, 2.0, 3.0]
    lstm = [2.0, 3.0, 4.0]
    res = compute_ensemble(tf, lstm, 3)
    assert res.ok
    assert res.values == [1.5, 2.5, 3.5]


def test_compute_ensemble_missing_timesfm():
    res = compute_ensemble(None, [1.0, 2.0], 2)
    assert not res.ok
    assert "TimesFM" in (res.error or "")


def test_has_any_prediction():
    assert has_any_prediction({"timesfm": [], "lstm": [1.0]})
    assert not has_any_prediction({"timesfm": [], "lstm": None})


def test_provider_map_and_warnings():
    results = [
        ProviderResult("timesfm", None, "not installed"),
        ProviderResult("lstm", [1.0, 2.0]),
    ]
    pmap = provider_map(results)
    assert pmap["lstm"]["ok"] is True
    assert pmap["timesfm"]["ok"] is False
    warnings = build_warnings(pmap)
    assert any("timesfm" in w for w in warnings)


def test_pick_best_model():
    actual = [100.0, 100.0]
    name, mae = pick_best_model(actual, [101.0, 99.0], [100.0, 100.0], None, None)
    assert name == "LSTM"
    assert mae == 0.0
