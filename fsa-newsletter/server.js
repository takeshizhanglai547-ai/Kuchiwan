/**
 * server.js
 * 金融庁ニュースレター自動生成サーバー
 * Express + Claude API + SSE (Server-Sent Events)
 */

import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { fetchFSAReports, getSampleData } from './scraper.js';
import {
  generateNewsletterStream,
  getDemoNewsletter,
  translateCategory
} from './newsletter-generator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

/**
 * ヘルスチェック
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    hasApiKey: !!process.env.ANTHROPIC_API_KEY,
    timestamp: new Date().toISOString()
  });
});

/**
 * 金融庁の最新情報リストを取得
 */
app.get('/api/fsa-news', async (req, res) => {
  try {
    const useSample = req.query.sample === 'true';

    if (useSample) {
      const sampleData = getSampleData();
      return res.json({
        success: true,
        items: sampleData.map(item => ({
          ...item,
          categoryLabel: translateCategory(item.category)
        })),
        source: 'sample'
      });
    }

    const items = await fetchFSAReports(15);
    res.json({
      success: true,
      items: items.map(item => ({
        ...item,
        categoryLabel: translateCategory(item.category)
      })),
      source: 'live',
      fetchedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('FSA情報取得エラー:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * ニュースレター生成 (Server-Sent Events でストリーミング)
 */
app.post('/api/generate-newsletter', async (req, res) => {
  const { reports, useDemo } = req.body;

  // SSEヘッダー設定
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // SSEメッセージ送信ヘルパー
  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // デモモード: APIキーなしでも動作確認できる
    if (useDemo || !process.env.ANTHROPIC_API_KEY) {
      sendEvent('status', { message: 'デモモードでニュースレターを生成中...' });
      await new Promise(resolve => setTimeout(resolve, 1000));
      sendEvent('newsletter_html', { html: getDemoNewsletter() });
      sendEvent('done', { message: '完了（デモモード）' });
      res.end();
      return;
    }

    if (!reports || reports.length === 0) {
      sendEvent('error', { message: '報告書データがありません' });
      res.end();
      return;
    }

    sendEvent('status', { message: `${reports.length}件の報告書を分析してニュースレターを生成中...` });

    // ストリーミング生成
    let fullHtml = '';
    const generator = generateNewsletterStream(reports);

    for await (const chunk of generator) {
      switch (chunk.type) {
        case 'status':
          sendEvent('status', { message: chunk.message });
          break;
        case 'thinking_start':
          sendEvent('thinking_start', {});
          break;
        case 'thinking':
          sendEvent('thinking', { content: chunk.content });
          break;
        case 'thinking_end':
          sendEvent('thinking_end', {});
          break;
        case 'content_start':
          sendEvent('content_start', {});
          break;
        case 'content':
          fullHtml += chunk.content;
          // ある程度溜まったらHTMLをパースして送信
          if (fullHtml.length > 100) {
            sendEvent('newsletter_chunk', { html: chunk.content });
          }
          break;
        case 'done':
          sendEvent('newsletter_complete', { totalLength: fullHtml.length });
          break;
        case 'error':
          sendEvent('error', { message: chunk.message });
          break;
      }
    }

    sendEvent('done', { message: '生成完了' });

  } catch (error) {
    console.error('ニュースレター生成エラー:', error);
    sendEvent('error', {
      message: `生成中にエラーが発生しました: ${error.message}`,
      code: error.status || 500
    });
  }

  res.end();
});

/**
 * FSAデータ取得 + ニュースレター生成を一括で行うSSEエンドポイント
 */
app.get('/api/full-pipeline', async (req, res) => {
  const useSample = req.query.sample === 'true';
  const maxItems = parseInt(req.query.max || '8', 10);

  // SSEヘッダー設定
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // Step 1: FSAデータ取得
    sendEvent('step', { step: 1, message: '金融庁ウェブサイトから最新情報を取得中...' });

    let reports;
    if (useSample || !process.env.ANTHROPIC_API_KEY) {
      await new Promise(resolve => setTimeout(resolve, 800));
      reports = getSampleData();
      sendEvent('reports_fetched', {
        count: reports.length,
        reports: reports.map(r => ({
          title: r.title,
          date: r.date,
          category: r.category,
          categoryLabel: translateCategory(r.category),
          url: r.url
        }))
      });
    } else {
      reports = await fetchFSAReports(maxItems);
      sendEvent('reports_fetched', {
        count: reports.length,
        reports: reports.map(r => ({
          title: r.title,
          date: r.date,
          category: r.category,
          categoryLabel: translateCategory(r.category),
          url: r.url
        }))
      });
    }

    // Step 2: ニュースレター生成
    sendEvent('step', { step: 2, message: 'Claude AIがニュースレターを執筆中...' });

    if (!process.env.ANTHROPIC_API_KEY) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      sendEvent('newsletter_html', { html: getDemoNewsletter() });
      sendEvent('done', { message: '完了（デモモード - APIキーを設定すると実際の分析が可能です）' });
      res.end();
      return;
    }

    let fullHtml = '';
    const generator = generateNewsletterStream(reports);

    for await (const chunk of generator) {
      switch (chunk.type) {
        case 'thinking_start':
          sendEvent('thinking_start', {});
          break;
        case 'thinking':
          // 思考プロセスはデバッグ用に送信（UI側で表示切替可能）
          sendEvent('thinking', { content: chunk.content.substring(0, 200) });
          break;
        case 'thinking_end':
          sendEvent('thinking_end', {});
          break;
        case 'content_start':
          sendEvent('content_start', {});
          break;
        case 'content':
          fullHtml += chunk.content;
          sendEvent('newsletter_chunk', { html: chunk.content });
          break;
        case 'done':
          sendEvent('newsletter_complete', { totalLength: fullHtml.length });
          break;
        case 'error':
          sendEvent('error', { message: chunk.message });
          break;
      }
    }

    sendEvent('done', { message: 'ニュースレター生成完了' });

  } catch (error) {
    console.error('パイプラインエラー:', error);
    sendEvent('error', {
      message: `処理中にエラーが発生しました: ${error.message}`
    });
  }

  res.end();
});

// フロントエンド用フォールバック
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`
🏛️  金融庁ニュースレター自動生成システム
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌐 サーバー起動: http://localhost:${PORT}
🔑 APIキー: ${process.env.ANTHROPIC_API_KEY ? '✅ 設定済み' : '❌ 未設定（デモモードで動作）'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
APIキーを設定するには:
  export ANTHROPIC_API_KEY=your-api-key-here
  `);
});
