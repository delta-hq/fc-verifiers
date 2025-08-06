#!/bin/bash

echo "=== OpenCode Custom Setup Script ==="

# Check if our custom binary was copied
if [ -f "/installed-agent/opencode-custom" ]; then
    echo "Found custom opencode binary!"
    echo "Binary size: $(stat -c%s /installed-agent/opencode-custom 2>/dev/null || stat -f%z /installed-agent/opencode-custom) bytes"
    echo "Binary MD5: $(md5sum /installed-agent/opencode-custom | cut -d' ' -f1)"
    
    cp /installed-agent/opencode-custom /usr/local/bin/opencode
    chmod +x /usr/local/bin/opencode
    echo "Installed custom opencode binary to /usr/local/bin/opencode"
    
    # Verify it works
    echo "Testing binary..."
    opencode --version || echo "WARNING: Binary version check failed"
    
    # Test if binary can be executed at all
    echo "Testing basic execution..."
    /usr/local/bin/opencode --help 2>&1 || echo "Binary execution test failed: $?"
    
    # Check file properties
    echo "Binary properties:"
    file /usr/local/bin/opencode
    ls -la /usr/local/bin/opencode
    
    # Check if our prompt modifications are in the binary
    echo "Checking for prompt modifications..."
    # Using grep on binary directly since strings might not be available
    if grep -q "IMPORTANT EXECUTION RULES" /usr/local/bin/opencode 2>/dev/null; then
        echo "✓ Custom prompt modifications detected in binary!"
    else
        echo "Warning: Could not verify prompt modifications (this is normal)"
    fi
else
    echo "No custom binary found, installing from npm..."
    
    # Original installation
    apt-get update
    apt-get install -y curl
    
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.2/install.sh | bash
    
    source "$HOME/.nvm/nvm.sh"
    
    nvm install 22
    npm -v
    
    npm i -g opencode-ai@latest
fi

echo "=== Setup complete ==="