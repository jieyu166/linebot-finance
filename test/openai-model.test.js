const assert = require('assert');
const { loadGs } = require('./harness');

// parseWithOpenAI／parsePdfWithOpenAI 在 OPENAI_MODEL 未設定時，應預設用
// 'gpt-4.1-mini'（live 測試顯示 gpt-4.1-mini 對三份信用卡帳單皆完整解析，
// gpt-4o-mini 會漏行）。以 PropertiesService/UrlFetchApp stub 注入，
// 擷取 UrlFetchApp.fetch 收到的 options.payload 逐一驗證。
let capturedPayload = null;
const gs = loadGs(['SheetService.gs', 'TransferService.gs', 'Config.gs', 'OpenAIService.gs'], {
  PropertiesService: {
    getScriptProperties: function() {
      return { getProperty: function() { return null; } }; // OPENAI_MODEL、OPENAI_API_KEY 皆未設定
    }
  },
  UrlFetchApp: {
    fetch: function(url, options) {
      capturedPayload = JSON.parse(options.payload);
      return {
        getResponseCode: function() { return 200; },
        getContentText: function() {
          return JSON.stringify({ choices: [{ message: { content: '{"transactions":[]}' } }] });
        }
      };
    }
  }
});

let failed = 0;
function t(name, fn) {
  try { fn(); console.log('PASS', name); }
  catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); }
}

t('parseWithOpenAI：OPENAI_MODEL 未設定時，payload.model 預設為 gpt-4.1-mini', () => {
  capturedPayload = null;
  gs.parseWithOpenAI('午餐80', ['飲食'], ['薪資'], []);
  assert.ok(capturedPayload, '未擷取到 payload');
  assert.strictEqual(capturedPayload.model, 'gpt-4.1-mini');
});

t('parsePdfWithOpenAI：OPENAI_MODEL 未設定時，payload.model 預設為 gpt-4.1-mini', () => {
  capturedPayload = null;
  gs.parsePdfWithOpenAI('帳單文字', ['飲食'], ['薪資'], []);
  assert.ok(capturedPayload, '未擷取到 payload');
  assert.strictEqual(capturedPayload.model, 'gpt-4.1-mini');
});

process.exit(failed === 0 ? 0 : 1);
