#!/bin/bash
# Setup script for Modal terminal-bench runner

echo "Setting up Modal for terminal-bench..."

# Install Modal CLI if not already installed
if ! command -v modal &> /dev/null; then
    echo "Installing Modal CLI..."
    pip install modal
fi

# Authenticate with Modal (if not already authenticated)
echo "Authenticating with Modal..."
modal token new

# Create secrets for API keys
echo ""
echo "Setting up API key secrets in Modal..."
echo "You'll need to provide your API keys for the agents to work."

# Check if secrets already exist, if not create them
modal secret list | grep -q "openai-api-key" || {
    echo "Creating OpenAI API key secret..."
    echo "Enter your OpenAI API key:"
    read -s OPENAI_KEY
    modal secret create openai-api-key OPENAI_API_KEY=$OPENAI_KEY
}

modal secret list | grep -q "anthropic-api-key" || {
    echo "Creating Anthropic API key secret..."
    echo "Enter your Anthropic API key (or press Enter to skip):"
    read -s ANTHROPIC_KEY
    if [ ! -z "$ANTHROPIC_KEY" ]; then
        modal secret create anthropic-api-key ANTHROPIC_API_KEY=$ANTHROPIC_KEY
    fi
}

modal secret list | grep -q "openrouter-api-key" || {
    echo "Creating OpenRouter API key secret..."
    echo "Enter your OpenRouter API key (or press Enter to skip):"
    read -s OPENROUTER_KEY
    if [ ! -z "$OPENROUTER_KEY" ]; then
        modal secret create openrouter-api-key OPENROUTER_API_KEY=$OPENROUTER_KEY
    fi
}

echo ""
echo "Modal setup complete!"
echo ""
echo "Usage examples:"
echo "  # Run specific tasks:"
echo "  modal run scripts/modal_terminal_bench.py --tasks hello-world,fibonacci-server"
echo ""
echo "  # Run with high concurrency:"
echo "  modal run scripts/modal_terminal_bench.py --tasks hello-world,sqlite-with-gcov --concurrent 20"
echo ""
echo "  # Run all tasks:"
echo "  modal run scripts/modal_terminal_bench.py --all-tasks --concurrent 50"
echo ""
echo "  # Deploy as a web endpoint:"
echo "  modal deploy scripts/modal_terminal_bench.py"