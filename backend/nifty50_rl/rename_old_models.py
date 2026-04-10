"""
Rename old models trained with STATE_DIM=9 to make way for new training with STATE_DIM=22
"""
import os
from pathlib import Path

# Get the directory where this script is located
script_dir = Path(__file__).parent
model_dir = script_dir / "models"
backup_suffix = "_old_state_dim_9"

if model_dir.exists():
    # Find all model files
    model_files = list(model_dir.glob("nifty50_dqn*.pt"))
    metadata_files = list(model_dir.glob("nifty50_dqn*_metadata.json"))
    
    print(f"Found {len(model_files)} model files and {len(metadata_files)} metadata files")
    
    # Rename model files
    renamed_count = 0
    for model_file in model_files:
        if "_old_" not in model_file.name:  # Don't rename already renamed files
            new_name = model_file.stem + backup_suffix + model_file.suffix
            new_path = model_file.parent / new_name
            model_file.rename(new_path)
            print(f"Renamed: {model_file.name} -> {new_name}")
            renamed_count += 1
    
    # Rename metadata files
    for meta_file in metadata_files:
        if "_old_" not in meta_file.name:
            new_name = meta_file.stem + backup_suffix + meta_file.suffix
            new_path = meta_file.parent / new_name
            meta_file.rename(new_path)
            print(f"Renamed: {meta_file.name} -> {new_name}")
            renamed_count += 1
    
    print(f"\n[SUCCESS] Renamed {renamed_count} files. Old models backed up with '{backup_suffix}' suffix.")
    print("New training can now start with STATE_DIM=22.")
else:
    print("Model directory not found!")

