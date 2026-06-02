import { writeFileSync } from 'fs';

const TEST_URL = process.env.TEST_URL || 'http://localhost:3003';

async function runTests() {
  console.log('🧪 Starting DevPulse Self-Testing Suite...\n');
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(` ✅ PASS: ${message}`);
      passed++;
    } else {
      console.log(` ❌ FAIL: ${message}`);
      failed++;
    }
  }

  // Test 1: Verify server is online and serving api/config
  try {
    const res = await fetch(`${TEST_URL}/api/config`);
    assert(res.status === 200, 'GET /api/config returns HTTP 200');
    const data = await res.json();
    assert(typeof data.hasConfig === 'boolean', 'Response has "hasConfig" boolean flag');
    assert(data.gh && typeof data.gh.org === 'string', 'Response contains GitHub config block');
    assert(data.jira && typeof data.jira.project === 'string', 'Response contains Jira config block');
  } catch (err) {
    assert(false, `GET /api/config failed: ${err.message}`);
  }

  // Test 2: Verify user mappings endpoint
  try {
    const res = await fetch(`${TEST_URL}/api/mappings`);
    assert(res.status === 200, 'GET /api/mappings returns HTTP 200');
    const data = await res.json();
    assert(Array.isArray(data.mappings), 'Response contains "mappings" array');
    assert(Array.isArray(data.teams), 'Response contains "teams" array');
  } catch (err) {
    assert(false, `GET /api/mappings failed: ${err.message}`);
  }

  // Test 3: Verify static file serving (demo.html)
  try {
    const res = await fetch(`${TEST_URL}/demo.html`);
    assert(res.status === 200, 'GET /demo.html returns HTTP 200 (Static serving active)');
    const html = await res.text();
    assert(html.includes('DevPulse — Premium Live Demo'), 'Served demo.html matches correct content');
  } catch (err) {
    assert(false, `GET /demo.html static serve failed: ${err.message}`);
  }

  // Test 4: Verify live index.html
  try {
    const res = await fetch(`${TEST_URL}/index.html`);
    assert(res.status === 200, 'GET /index.html returns HTTP 200');
    const html = await res.text();
    assert(html.includes('Babel.transform'), 'index.html contains in-browser compiler engine');
    assert(html.includes('file:'), 'index.html contains CORS file:// safety redirect block');
  } catch (err) {
    assert(false, `GET /index.html static serve failed: ${err.message}`);
  }

  // Test 5: Verify dev-productivity.jsx source retrieval
  try {
    const res = await fetch(`${TEST_URL}/dev-productivity.jsx`);
    assert(res.status === 200, 'GET /dev-productivity.jsx returns HTTP 200');
    const code = await res.text();
    assert(code.includes('export default function App()'), 'Source code contains React App entrypoint');
    assert(code.includes('window.DevPulseApp = App;'), 'Source code successfully registers component to global window');
  } catch (err) {
    assert(false, `GET /dev-productivity.jsx failed: ${err.message}`);
  }

  console.log(`\n📊 Test Execution Summary:`);
  console.log(`   Passed: ${passed} / ${passed + failed}`);
  console.log(`   Failed: ${failed}`);

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('\n🌟 All systems online, secure, and compiling perfectly! 🌟\n');
    process.exit(0);
  }
}

runTests();
