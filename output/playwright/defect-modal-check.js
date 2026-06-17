async function checkDefectModal(page) {
  await page.context().unrouteAll();
  await page.context().route('**/api/v1/projects', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: 0, message: 'ok', data: [{ id: 1, name: '演示项目', description: 'visual', owner: 'QA' }] }) });
  });
  await page.context().route('**/api/v1/environment-configs**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: 0, message: 'ok', data: [] }) });
  });
  await page.context().route('**/api/v1/defects**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: 0, message: 'ok', data: [] }) });
  });
  await page.goto('http://127.0.0.1:5174/');
  await page.evaluate(() => {
    localStorage.setItem('active_project_id', '1');
    localStorage.setItem('auth_user', JSON.stringify({ username: 'QA', account: 'qa' }));
    localStorage.setItem('access_token', 'visual-check-token');
  });
  await page.setViewportSize({ width: 1613, height: 1054 });
  await page.goto('http://127.0.0.1:5174/defects#/');
  await page.getByRole('button', { name: /新建缺陷/ }).click();
  await page.screenshot({ path: 'output/playwright/defect-modal-check.png', fullPage: true });
  const result = await page.evaluate(() => {
    const modal = document.querySelector('.defect-editor-modal');
    const actions = document.querySelector('.defect-editor-actions');
    const required = Array.from(document.querySelectorAll('.required-mark')).map((node) => getComputedStyle(node).color);
    if (!modal || !actions) return { ok: false, reason: 'modal or actions missing' };
    const modalRect = modal.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();
    return {
      ok: actionsRect.bottom <= window.innerHeight && actionsRect.top >= modalRect.top,
      modalBottom: modalRect.bottom,
      actionsBottom: actionsRect.bottom,
      viewportHeight: window.innerHeight,
      required,
    };
  });
  console.log(JSON.stringify(result));
}
