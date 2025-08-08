import { test, expect } from '@playwright/test';

test('log parsing shows complete Python code', async ({ page }) => {
  // Navigate to dashboard
  await page.goto('http://localhost:3002');
  
  // Wait for runs to load
  await page.waitForSelector('text=fibonacci-server', { timeout: 10000 });
  
  // Click on fibonacci-server run
  await page.click('text=fibonacci-server');
  
  // Wait for logs to load
  await page.waitForSelector('text=commands.txt', { timeout: 10000 });
  
  // Click on commands.txt section
  await page.click('text=commands.txt');
  
  // Check if the complete Python code is visible
  const content = await page.textContent('[data-testid="log-content"]') || await page.textContent('pre') || await page.textContent('code');
  
  console.log('Found content:', content?.slice(0, 500));
  
  // Look for the complete if __name__ block
  expect(content).toContain("if __name__ == '__main__':");
  expect(content).toContain('PORT = 3000');
  expect(content).toContain('httpd.serve_forever()');
});