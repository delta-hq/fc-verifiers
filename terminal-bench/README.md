# Terminal-bench AI Agents

This directory contains AI agents for terminal-bench evaluation:
- **OpenCode Agent**: Modified CLI tool with execution-focused prompts  
- **Claude Agent**: Direct API implementation using Claude Opus 4

## Quick Start

```bash
# Run with OpenCode (default)
./run-benchmark.sh --tasks hello-world fibonacci-server

# Run with Claude direct API
export OPENROUTER_API_KEY="your-key"
./run-benchmark.sh --agent claude --tasks hello-world

# Run all tasks
./run-benchmark.sh --agent opencode  # or --agent claude

# Review failed task
./review-task.sh fibonacci-server
```

## Files
- `opencode_agent.py` - Terminal-bench agent that uses custom binary if available, falls back to npm
- `opencode-setup.sh` - Setup script that installs custom binary or npm version in Docker containers
- `opencode/` - Git submodule with OpenCode source code (for building from source)
- `run-benchmark.sh` - Main benchmark runner (auto-rebuilds binary)
- `review-task.sh` - Task review helper
- `build-opencode.sh` - Binary build script

## How Terminal-bench Works

1. **Task Isolation**: Each terminal-bench task runs in its own Docker container
2. **Agent Installation**: The `opencode-setup.sh` script is executed inside the container to install the agent
3. **Task Execution**: The agent receives the task instruction and must execute commands inside the container
4. **Verification**: Terminal-bench runs tests (e.g., pytest) to verify the task was completed correctly

### What opencode-setup.sh Does

The `opencode-setup.sh` script is automatically executed by terminal-bench inside each Docker container before running the agent. It:

1. Checks if a custom `opencode-custom` binary was copied to `/installed-agent/`
2. If found: Installs the custom binary to `/usr/local/bin/opencode`
3. If not found: Falls back to installing from npm (includes installing Node.js, etc.)

The agent (`opencode_agent.py`) overrides `perform_task()` to copy the custom binary if it exists at `opencode/opencode-custom`.

## Agent Comparison

### OpenCode Agent
- **Approach**: Wraps the OpenCode CLI tool, modifying its prompts
- **Pros**: Can leverage OpenCode's existing features and tools
- **Cons**: Complex build process, requires Bun and Docker
- **Best for**: Tasks that benefit from OpenCode's tooling

### Claude Agent  
- **Approach**: Direct API calls with structured XML responses
- **Pros**: Simple, clean implementation with full control
- **Cons**: Requires OpenRouter API key, costs per API call
- **Best for**: Complex reasoning tasks, when you need Opus 4's capabilities

## How We Fixed OpenCode

The default OpenCode agent would provide instructions instead of executing commands. We modified the prompts to enforce execution:

1. **Modified Prompts**: Changed `opencode/packages/opencode/src/session/prompt/beast.txt` to enforce execution
2. **Custom Binary**: Build and use a custom binary with our modifications
3. **Auto-rebuild**: The benchmark script automatically rebuilds with latest changes

### Current Results
- Simple tasks (hello-world): ✅ 100% accuracy
- Complex multi-step tasks: ❌ Still need improvement

## Setup

1. Install terminal-bench:
```bash
pip install terminal-bench
```

2. Install Bun (JavaScript runtime):
```bash
curl -fsSL https://bun.sh/install | bash
```

3. Initialize the OpenCode submodule and install dependencies:
```bash
cd terminal-bench
git submodule update --init --recursive
cd opencode
bun install
```

3. Set up environment variables in `.env` file or export them:
```bash
export OPENAI_API_KEY="your-key"
export ANTHROPIC_API_KEY="your-key"
# Add other API keys as needed
```

## Running Benchmarks

### Using Our Scripts (Recommended)

```bash
# Run with default settings (4 concurrent tasks)
./run-benchmark.sh

# Run specific tasks
./run-benchmark.sh --tasks hello-world broken-python

# Adjust concurrency
./run-benchmark.sh --concurrent 8

# Different model
./run-benchmark.sh --model openai/gpt-4o
```

#### Script Features
- **Auto-rebuild**: Automatically rebuilds binary with latest prompt changes
- **Timing**: Shows start/end times and total duration
- **Progress**: Live output during execution
- **Summary**: Shows pass/fail counts and failed task names

### Manual Terminal-bench Commands

```bash
# Basic usage
PYTHONPATH=terminal-bench:. tb run --dataset terminal-bench-core \
  --task-id hello-world \
  --agent-import-path "opencode_agent:OpenCodeAgent" \
  --model openai/gpt-4o-mini
```

## Reviewing Results

### Understanding Run Output
Each run creates a timestamped directory in `runs/` (format: `YYYY-MM-DD__HH-MM-SS`):
```
runs/2025-08-06__08-54-04/
├── results.json          # Overall results summary
├── run.log              # Detailed execution log
├── run_metadata.json    # Run configuration
└── <task-name>/         # Each task gets its own directory
    └── <task-instance>/
        ├── results.json     # Task-specific results
        ├── panes/          # Terminal output
        │   ├── post-agent.txt   # Agent's output
        │   └── post-test.txt    # Test results
        └── sessions/       # Recordings
            └── agent.cast  # Replay with: asciinema play <file>
```

### Review Commands
```bash
# Review specific task from latest run
./review-task.sh fibonacci-server

# Review from specific run
./review-task.sh grid-pattern-transform 2025-08-06__08-54-04

# Manual review - agent output
cat runs/$(ls -t runs/ | head -1)/fibonacci-server/*/panes/post-agent.txt

# Watch agent execution recording
asciinema play runs/$(ls -t runs/ | head -1)/fibonacci-server/*/sessions/agent.cast

# View overall results
cat runs/$(ls -t runs/ | head -1)/results.json | jq
```

## Available Models

The OpenCode agent supports various model providers:
- OpenAI: `openai/gpt-4o`, `openai/gpt-4o-mini`, etc.
- Anthropic: `anthropic/claude-3-5-sonnet-20241022`, etc.
- Google: `google/gemini-pro`, etc.
- DeepSeek: `deepseek/deepseek-v2`, etc.
- And many more (see `opencode_agent.py` for full list of supported API keys)

## Performance

### Timing
- **Binary rebuild**: ~350ms (automatic on each run)
- **Per task**: 25 seconds to 2+ minutes depending on complexity
- **Full benchmark (120 tasks)**: Several hours

### Parallelization
- **Default**: 4 concurrent tasks
- **Recommended**: 6-8 for good performance
- **Maximum**: 10-12 (watch for API rate limits)

Your system has 14 CPUs and 7.6GB Docker memory available.

## Development Workflow

### Modifying the Agent

1. **Edit prompts** in `opencode/packages/opencode/src/session/prompt/`:
   - GPT models: `beast.txt`
   - Claude: `anthropic.txt`

2. **Test changes**:
   ```bash
   ./run-benchmark.sh --tasks hello-world --concurrent 1
   ```

3. **Review results**:
   ```bash
   ./review-task.sh hello-world
   ```

4. **Iterate** until working, then test broader:
   ```bash
   ./run-benchmark.sh --tasks hello-world fibonacci-server grid-pattern-transform
   ```

### Key Modifications Made
- Added rules like "DO NOT provide instructions or tutorials - actually DO the work"
- Emphasized completing ALL parts of tasks (e.g., "create AND run")
- Added "STOP IMMEDIATELY after tool use" to prevent explanations

## Troubleshooting

### Common Issues
1. **Rate limits**: Reduce concurrency with `--concurrent 2`
2. **Binary architecture**: Must be Linux ARM64 for Docker containers
3. **API keys**: Set `OPENAI_API_KEY` environment variable
4. **Timeout messages**: Normal for longer runs, check `runs/` directory for results

### Debug Commands
```bash
# Verify custom binary is used
grep "Custom prompt modifications" runs/*/hello-world/*/panes/post-agent.txt

# Check binary format
file opencode/opencode-custom

# View detailed logs
less runs/$(ls -t runs/ | head -1)/run.log
```

## Notes

- The "Note: <file> was modified" messages during runs are normal - terminal-bench checks file integrity
- Always use scripts instead of one-off commands for consistency
- Binary is rebuilt automatically, so changes take effect immediately
- Results are saved in timestamped directories for easy comparison

## Help
```bash
tb run --help  # Show all terminal-bench options
./run-benchmark.sh --help  # Show our script options
```