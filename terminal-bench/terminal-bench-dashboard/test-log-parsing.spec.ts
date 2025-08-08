import { test, expect } from '@playwright/test';

test('check if log parsing shows complete Python code', async ({ page }) => {
  // Navigate to dashboard
  await page.goto('http://localhost:3002');
  
  // Wait for page to load
  await page.waitForLoadState('networkidle');
  
  // Look for fibonacci-server run
  const fibonacciRun = page.locator('text=fibonacci-server').first();
  await expect(fibonacciRun).toBeVisible({ timeout: 10000 });
  
  // Click on fibonacci-server run
  await fibonacciRun.click();
  
  // Wait for logs to load and look for commands.txt section
  const commandsSection = page.locator('text=commands.txt');
  await expect(commandsSection).toBeVisible({ timeout: 10000 });
  
  // Click on commands.txt section to expand it
  await commandsSection.click();
  
  // Wait a moment for content to load
  await page.waitForTimeout(1000);
  
  // Get all text content from the page
  const pageContent = await page.textContent('body');
  
  console.log('=== CHECKING FOR PYTHON CODE ===');
  console.log('Contains if __name__:', pageContent?.includes("if __name__ == '__main__':"));
  console.log('Contains PORT = 3000:', pageContent?.includes('PORT = 3000'));
  console.log('Contains serve_forever:', pageContent?.includes('serve_forever()'));
  
  // Look for a section that might contain the Python code
  const sections = await page.locator('details').all();
  console.log('Found', sections.length, 'sections');
  
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const summary = await section.locator('summary').textContent();
    console.log(`Section ${i}:`, summary);
    
    if (summary?.includes('commands.txt')) {
      // This should be our section with Python code
      await section.click(); // Open it
      const content = await section.textContent();
      
      console.log('commands.txt content length:', content?.length);
      console.log('Contains if __name__:', content?.includes("if __name__ == '__main__':"));
      console.log('Contains PORT = 3000:', content?.includes('PORT = 3000'));
      console.log('Contains serve_forever:', content?.includes('serve_forever()'));
      
      // Show a snippet around the if __name__ part
      if (content?.includes("if __name__")) {
        const index = content.indexOf("if __name__");
        const snippet = content.slice(Math.max(0, index - 100), index + 200);
        console.log('Snippet around if __name__:', snippet);
      }
      
      // These should all be present if parsing worked
      expect(content).toContain("if __name__ == '__main__':");
      expect(content).toContain('PORT = 3000');
      expect(content).toContain('serve_forever()');
      
      break;
    }
  }
});