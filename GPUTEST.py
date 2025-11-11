import torch
import sys

print("Checking GPU information...")
print(f"Python version: {sys.version}")
print(f"PyTorch version: {torch.__version__}")
print(f"CUDA available: {torch.cuda.is_available()}")
if torch.cuda.is_available():
    print(f"CUDA version: {torch.version.cuda}")
    print(f"GPU device: {torch.cuda.get_device_name(0)}")
    print(f"GPU compute capability: {torch.cuda.get_device_capability(0)}")

    # Test GPU computation
    x = torch.randn(3, 3).cuda()
    print(f"GPU tensor: {x}")
    print("GPU computation test passed!")