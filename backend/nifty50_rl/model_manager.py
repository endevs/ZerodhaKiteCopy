"""
Model management: save, load, and list trained models
"""
import os
import json
import logging
import datetime
from typing import Optional, Dict, Any, List
from pathlib import Path
# Import config from local nifty50_rl package
import sys
import os
import importlib.util
_current_dir = os.path.dirname(os.path.abspath(__file__))
_config_path = os.path.join(_current_dir, 'config.py')
spec = importlib.util.spec_from_file_location("nifty50_rl_config", _config_path)
config = importlib.util.module_from_spec(spec)
spec.loader.exec_module(config)

logger = logging.getLogger(__name__)


def get_latest_model_path() -> Optional[str]:
    """
    Get path to the latest saved model.
    Excludes old models with '_old_' in the filename.
    
    Returns:
        Path to latest model file, or None if no models exist
    """
    model_dir = Path(config.MODEL_DIR)
    if not model_dir.exists():
        return None
    
    # Look for latest model file, excluding old models
    model_files = [
        f for f in model_dir.glob(f"{config.MODEL_PREFIX}_*.pt")
        if "_old_" not in f.name  # Exclude old models
    ]
    if not model_files:
        return None
    
    # Sort by modification time, get latest
    latest_model = max(model_files, key=lambda p: p.stat().st_mtime)
    return str(latest_model)


def save_model(agent: Any, metadata: Dict[str, Any], model_dir: Optional[str] = None) -> str:
    """
    Save trained model with metadata.
    
    Args:
        agent: DQN agent with model to save
        metadata: Dictionary with training metadata
        model_dir: Optional custom model directory
    
    Returns:
        Path to saved model file
    """
    model_dir = model_dir or config.MODEL_DIR
    os.makedirs(model_dir, exist_ok=True)
    
    # Generate filename with timestamp
    timestamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    model_filename = f"{config.MODEL_PREFIX}_{timestamp}.pt"
    model_path = os.path.join(model_dir, model_filename)
    
    # Save model
    agent.save_model(model_path)
    
    # Save metadata
    metadata_filename = f"{config.MODEL_PREFIX}_{timestamp}_metadata.json"
    metadata_path = os.path.join(model_dir, metadata_filename)
    metadata['model_path'] = model_path
    metadata['saved_at'] = datetime.datetime.now().isoformat()
    
    with open(metadata_path, 'w') as f:
        json.dump(metadata, f, indent=2)
    
    # Create/update latest symlink (or copy on Windows)
    latest_path = os.path.join(model_dir, config.LATEST_MODEL_NAME)
    try:
        if os.path.exists(latest_path):
            os.remove(latest_path)
        # On Windows, copy instead of symlink
        import shutil
        shutil.copy2(model_path, latest_path)
    except Exception as e:
        logger.warning(f"Could not create latest model link: {e}")
    
    logger.info(f"Model saved: {model_path}")
    logger.info(f"Metadata saved: {metadata_path}")
    
    return model_path


def load_model_metadata(model_path: str) -> Dict[str, Any]:
    """
    Load metadata for a saved model.
    
    Args:
        model_path: Path to model file
    
    Returns:
        Dictionary with model metadata
    """
    # Find corresponding metadata file
    base_name = os.path.splitext(os.path.basename(model_path))[0]
    metadata_path = model_path.replace('.pt', '_metadata.json')
    
    if os.path.exists(metadata_path):
        with open(metadata_path, 'r') as f:
            return json.load(f)
    else:
        # Return default metadata if file not found
        return {
            'model_path': model_path,
            'episodes': 'Unknown',
            'win_rate': 'Unknown',
            'sharpe_ratio': 'Unknown'
        }


def list_saved_models(model_dir: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    List all saved models with their metadata.
    
    Args:
        model_dir: Optional custom model directory
    
    Returns:
        List of dictionaries with model info
    """
    model_dir = model_dir or config.MODEL_DIR
    if not os.path.exists(model_dir):
        return []
    
    models = []
    for model_file in Path(model_dir).glob(f"{config.MODEL_PREFIX}_*.pt"):
        # Skip old models
        if "_old_" in model_file.name:
            continue
        metadata = load_model_metadata(str(model_file))
        models.append({
            'path': str(model_file),
            'filename': model_file.name,
            'modified': datetime.datetime.fromtimestamp(model_file.stat().st_mtime).isoformat(),
            'metadata': metadata
        })
    
    # Sort by modification time (newest first)
    models.sort(key=lambda x: x['modified'], reverse=True)
    
    return models

