// Test script to verify log parsing
const fs = require('fs');

// Simulate the parsing logic from the dashboard
function testParsing() {
  // Get the logs from the API endpoint
  const logs = `=== Agent Log ===
Agent log content...

=== Commands ===
Commands content with some == operators...

=== agent.log ===
[?2004hroot@a4dc45b04f8e:/app# asciinema rec --stdin /logs/agent.cast

=== tests.log ===
===================================================================== test session starts ======================================================================
platform linux -- Python 3.11.0, pytest-8.3.3, pluggy-1.5.0
collected 6 items

=== commands.txt ===
['asciinema rec --stdin /logs/agent.cast', 'Enter']
['clear', 'Enter']
'pwd'
'Enter'
"cat > server.py << 'EOF'
import http.server
import socketserver
import json
from urllib.parse import urlparse, parse_qs

class FibonacciHandler(http.server.BaseHTTPRequestHandler):
    def fibonacci(self, n):
        if n <= 1:
            return n
        a, b = 0, 1
        for _ in range(2, n + 1):
            a, b = b, a + b
        return b

    def log_message(self, format, *args):
        # Override to reduce logging
        return

if __name__ == '__main__':
    PORT = 3000
    with socketserver.TCPServer(('', PORT), FibonacciHandler) as httpd:
        print(f'Server running on port {PORT}')
        httpd.serve_forever()
EOF"

=== Task Results ===
Status: PASSED
`;

  console.log('=== TESTING LOG PARSING ===');
  console.log('Total log length:', logs.length);

  // Test the parsing logic from the dashboard
  const knownSections = [
    'Agent Log',
    'commands.txt',
    'agent.log',
    'tests.log',
    'Command History',
    'Task Results',
    'panes/post-agent.txt',
    'panes/post-test.txt'
  ];

  const sections = [];

  for (const sectionName of knownSections) {
    // Look for section header that starts at line beginning
    const headerPattern = `\n=== ${sectionName} ===\n`;
    let sectionStart = logs.indexOf(headerPattern);

    if (sectionStart === -1) {
      // Try without leading newline (for first section)
      const altPattern = `=== ${sectionName} ===\n`;
      sectionStart = logs.indexOf(altPattern);
      if (sectionStart !== -1) {
        sectionStart = sectionStart + altPattern.length;
      }
    } else {
      sectionStart = sectionStart + headerPattern.length;
    }

    if (sectionStart !== -1) {
      // Find the next section start
      let contentEnd = logs.length;
      for (const otherSection of knownSections) {
        if (otherSection === sectionName) continue;
        const nextPattern = `\n=== ${otherSection} ===\n`;
        const nextSectionStart = logs.indexOf(nextPattern, sectionStart);
        if (nextSectionStart !== -1 && nextSectionStart < contentEnd) {
          contentEnd = nextSectionStart;
        }
      }

      const content = logs.slice(sectionStart, contentEnd).trim();
      if (content) {
        sections.push({ name: sectionName, content });
      }
    }
  }

  console.log('Found sections:', sections.length);
  
  for (const section of sections) {
    console.log(`\n--- ${section.name} ---`);
    console.log('Length:', section.content.length);
    
    if (section.name === 'commands.txt') {
      console.log('Contains if __name__:', section.content.includes("if __name__ == '__main__':"));
      console.log('Contains PORT = 3000:', section.content.includes('PORT = 3000'));
      console.log('Contains serve_forever:', section.content.includes('serve_forever()'));
      
      // Show content around if __name__
      if (section.content.includes("if __name__")) {
        const index = section.content.indexOf("if __name__");
        const snippet = section.content.slice(Math.max(0, index - 50), index + 150);
        console.log('Snippet around if __name__:', snippet);
      }
      
      console.log('Full content:', section.content);
    }
  }
}

testParsing();