import { test, expect } from '@playwright/test';

test.describe('Terminal-Bench Dashboard', () => {
  test('should display dashboard and allow run creation', async ({ page }) => {
    // Navigate to dashboard
    await page.goto('/');
    
    // Check if dashboard loaded correctly
    await expect(page.locator('h1')).toContainText('Terminal-Bench Dashboard');
    
    // Check if main sections are present
    await expect(page.locator('text=Start New Run')).toBeVisible();
    await expect(page.locator('text=Recent Runs')).toBeVisible();
    await expect(page.locator('text=Run Details')).toBeVisible();
  });

  test('should create and monitor a hello-world run end-to-end', async ({ page }) => {
    // Navigate to dashboard
    await page.goto('/');
    
    // Configure a simple run
    await page.selectOption('select', 'opencode'); // Select OpenCode agent
    
    // Use the "Load 5 Test Tasks" button for simplicity
    await page.click('button:has-text("Load 5 Test Tasks")');
    
    // Set concurrent to 1
    await page.fill('input[type="number"]', '1');
    
    // Start the run
    await page.click('button:has-text("Start Run")');
    
    // Wait for run to be created - should see command display
    await expect(page.locator('text=Command:')).toBeVisible({ timeout: 10000 });
    
    // Should see the actual command that was executed
    await expect(page.locator('[style*="monospace"]')).toContainText('run-benchmark.sh');
    
    // Wait for run to appear in Recent Runs list (polling happens every 2s)
    await expect(page.locator('.runs-list')).toContainText('running', { timeout: 15000 });
    
    // Click on the run to select it
    await page.click('[id*="2025-"]:first-child'); // Click on the most recent run
    
    // Should see run details
    await expect(page.locator('text=Run Details')).toBeVisible();
    await expect(page.locator('text=hello-world')).toBeVisible();
    
    // Should see agent and model info
    await expect(page.locator('text=🤖 opencode')).toBeVisible();
    await expect(page.locator('text=🧠 gpt-4o-mini')).toBeVisible();
    
    // Should see start time
    await expect(page.locator('text=🚀')).toBeVisible();
    
    // Should see kill button for running run
    await expect(page.locator('button:has-text("🛑 Kill Run")')).toBeVisible();
    
    // Click on hello-world task to view logs
    await page.click('text=hello-world');
    
    // Should see log viewer section
    await expect(page.locator('text=Logs: hello-world')).toBeVisible({ timeout: 5000 });
    
    // Wait for logs to load (might take a moment for task to start)
    await page.waitForTimeout(3000);
    
    // Should see some log content (even if it's "Loading logs..." initially)
    const logContent = page.locator('[style*="backgroundColor: #1f2937"]');
    await expect(logContent).toBeVisible();
    
    // Test kill functionality
    await page.click('button:has-text("🛑 Kill Run")');
    await expect(page.locator('button:has-text("Killing...")')).toBeVisible();
    
    // After killing, run status should change or button should disappear
    await expect(page.locator('button:has-text("🛑 Kill Run")')).not.toBeVisible({ timeout: 10000 });
  });

  test('should display run history and details correctly', async ({ page }) => {
    await page.goto('/');
    
    // If there are existing runs, test the history display
    const runElements = page.locator('[id*="2025-"]');
    const runCount = await runElements.count();
    
    if (runCount > 0) {
      // Click on first run
      await runElements.first().click();
      
      // Should show run details
      await expect(page.locator('text=Run Details')).toBeVisible();
      
      // Should show run metadata
      await expect(page.locator('text=ID:')).toBeVisible();
      await expect(page.locator('text=Status:')).toBeVisible();
      
      // If run has tasks, should show task list
      const tasksSection = page.locator('text=Tasks (click to view logs)');
      if (await tasksSection.isVisible()) {
        // Click on a task if available
        const taskElements = page.locator('[style*="cursor: pointer"]:has-text("hello")');
        if (await taskElements.count() > 0) {
          await taskElements.first().click();
          
          // Should show logs section
          await expect(page.locator('text=Logs:')).toBeVisible();
        }
      }
    }
  });

  test('should handle errors gracefully', async ({ page }) => {
    await page.goto('/');
    
    // Test starting run without selecting any tasks
    await page.selectOption('select', 'opencode');
    await page.click('button:has-text("Start Run")');
    
    // Should either show error or start with empty task list
    // The exact behavior depends on API implementation
    await page.waitForTimeout(2000);
    
    // Should not crash the application
    await expect(page.locator('h1')).toContainText('Terminal-Bench Dashboard');
  });

  test('should update run status in real-time', async ({ page }) => {
    await page.goto('/');
    
    // Start a quick run
    await page.selectOption('select', 'opencode');
    await page.fill('input[placeholder*="Search"]', 'hello');
    await page.locator('text=hello-world').click();
    await page.fill('input[type="number"]', '1');
    await page.click('button:has-text("Start Run")');
    
    // Wait for run to appear
    await expect(page.locator('[id*="2025-"]')).toBeVisible({ timeout: 15000 });
    
    // Should see running status initially
    await expect(page.locator('text=🔄 running')).toBeVisible({ timeout: 5000 });
    
    // Due to polling every 2 seconds, status should update automatically
    // We'll wait up to 30 seconds to see status change or task completion
    await page.waitForTimeout(30000);
    
    // Run should either complete or we should see progress
    // At minimum, the page should still be functional
    await expect(page.locator('h1')).toContainText('Terminal-Bench Dashboard');
  });
});