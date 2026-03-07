/**
 * scraper.js
 * 金融庁（FSA）ウェブサイトから報告書・発表資料を取得するスクレイパー
 */

import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';

const FSA_BASE_URL = 'https://www.fsa.go.jp';

// 金融庁の主要な報告書・発表資料ページ
const FSA_PAGES = [
  {
    name: '報告書・調査結果等',
    url: 'https://www.fsa.go.jp/news/r6/index.html',
    category: 'reports'
  },
  {
    name: '監督指針・パブリックコメント等',
    url: 'https://www.fsa.go.jp/news/r6/ginkou/index.html',
    category: 'supervision'
  },
  {
    name: '新聞発表',
    url: 'https://www.fsa.go.jp/news/r6/',
    category: 'press'
  }
];

/**
 * URLからHTMLを取得する（文字コード対応）
 */
async function fetchPage(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; FSA-Newsletter-Bot/1.0)',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ja,en;q=0.5',
    },
    timeout: 30000
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status} for ${url}`);
  }

  const contentType = response.headers.get('content-type') || '';
  const buffer = await response.arrayBuffer();
  const bytes = Buffer.from(buffer);

  // Shift-JIS / EUC-JP 対応
  if (contentType.includes('charset=shift_jis') ||
      contentType.includes('charset=Shift_JIS') ||
      contentType.includes('charset=sjis')) {
    return iconv.decode(bytes, 'Shift_JIS');
  } else if (contentType.includes('charset=euc-jp') ||
             contentType.includes('charset=EUC-JP')) {
    return iconv.decode(bytes, 'EUC-JP');
  }

  // HTMLのmeta charset を確認
  const rawText = bytes.toString('utf-8');
  if (rawText.includes('charset=shift_jis') ||
      rawText.includes('charset=Shift_JIS') ||
      rawText.includes('charset=sjis')) {
    return iconv.decode(bytes, 'Shift_JIS');
  }

  return rawText;
}

/**
 * 相対URLを絶対URLに変換
 */
function resolveUrl(base, href) {
  if (!href) return null;
  if (href.startsWith('http://') || href.startsWith('https://')) return href;
  if (href.startsWith('/')) return FSA_BASE_URL + href;
  const baseUrl = new URL(base);
  return new URL(href, baseUrl).toString();
}

/**
 * 金融庁トップページから最新の報告書・発表資料を取得
 */
async function fetchFSANews() {
  const items = [];

  try {
    // メインの新着情報ページを取得
    const mainUrl = 'https://www.fsa.go.jp/news/r6/';
    const html = await fetchPage(mainUrl);
    const $ = cheerio.load(html);

    // 新着情報のリストを抽出
    $('a').each((_, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().trim();

      if (!href || !text || text.length < 5) return;

      // 報告書・監督指針・パブリックコメント等に関するリンクをフィルタ
      const keywords = [
        '報告書', '調査結果', '監督指針', 'ガイドライン', '規制', '改正',
        '公表', '意見募集', 'パブリックコメント', '検査', '処分', '行政',
        '金融', '銀行', '保険', '証券', 'フィンテック', 'FinTech',
        'リスク', '規則', '告示', '府令', '業務改善', '業務停止',
        '注意喚起', 'サイバー', 'マネロン', 'AML', '暗号資産'
      ];

      const hasKeyword = keywords.some(kw =>
        text.includes(kw) || (href && href.includes('news'))
      );

      if (hasKeyword && href.includes('.html') || href.includes('.pdf')) {
        const absoluteUrl = resolveUrl(mainUrl, href);
        if (absoluteUrl && absoluteUrl.includes('fsa.go.jp')) {
          items.push({
            title: text,
            url: absoluteUrl,
            date: extractDateFromText(text) || new Date().toISOString().split('T')[0],
            category: categorizeItem(text, href)
          });
        }
      }
    });

    // 重複除去
    const seen = new Set();
    return items.filter(item => {
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    }).slice(0, 20); // 最新20件

  } catch (error) {
    console.error('FSAページ取得エラー:', error.message);
    return getSampleData(); // エラー時はサンプルデータを返す
  }
}

/**
 * 特定のページから詳細内容を取得
 */
async function fetchPageContent(url) {
  try {
    if (url.endsWith('.pdf')) {
      return {
        title: 'PDF文書',
        content: '（PDF文書のため、タイトルと概要のみ分析します）',
        isPdf: true
      };
    }

    const html = await fetchPage(url);
    const $ = cheerio.load(html);

    // タイトル取得
    const title = $('h1').first().text().trim() ||
                  $('title').text().trim() ||
                  $('h2').first().text().trim();

    // メインコンテンツ取得
    // 金融庁のページ構造に合わせた抽出
    let content = '';

    // 本文エリアを抽出
    const mainContent = $('#main, .main-content, #content, .content, article, .article, [role="main"]');
    if (mainContent.length > 0) {
      content = mainContent.text();
    } else {
      // フォールバック: body全体からナビゲーション等を除いたテキスト
      $('nav, header, footer, .nav, .header, .footer, script, style, noscript').remove();
      content = $('body').text();
    }

    // テキスト整形
    content = content
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n')
      .trim()
      .substring(0, 5000); // 最大5000文字

    return { title, content, isPdf: false };

  } catch (error) {
    console.error(`ページ取得エラー (${url}):`, error.message);
    return { title: '', content: '', isPdf: false, error: error.message };
  }
}

/**
 * テキストから日付を抽出
 */
function extractDateFromText(text) {
  const patterns = [
    /(\d{4})年(\d{1,2})月(\d{1,2})日/,
    /(\d{4})\.(\d{1,2})\.(\d{1,2})/,
    /(\d{4})\/(\d{1,2})\/(\d{1,2})/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const [, year, month, day] = match;
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
  }
  return null;
}

/**
 * 報告書の種類を分類
 */
function categorizeItem(text, url) {
  if (text.includes('パブリックコメント') || text.includes('意見募集')) return 'public-comment';
  if (text.includes('処分') || text.includes('業務改善') || text.includes('業務停止')) return 'enforcement';
  if (text.includes('ガイドライン') || text.includes('監督指針')) return 'guideline';
  if (text.includes('調査') || text.includes('報告書')) return 'report';
  if (text.includes('改正') || text.includes('府令') || text.includes('規則') || text.includes('告示')) return 'regulation';
  if (text.includes('注意喚起')) return 'alert';
  return 'general';
}

/**
 * エラー時のサンプルデータ（デモ用）
 */
function getSampleData() {
  return [
    {
      title: '令和6年度 金融行政方針について',
      url: 'https://www.fsa.go.jp/news/r6/20240820.html',
      date: '2024-08-20',
      category: 'report'
    },
    {
      title: '金融商品取引業者等向けの総合的な監督指針の改正について',
      url: 'https://www.fsa.go.jp/news/r6/shouken/20240701.html',
      date: '2024-07-01',
      category: 'guideline'
    },
    {
      title: '暗号資産交換業者に対する業務改善命令について',
      url: 'https://www.fsa.go.jp/news/r6/virtual_currency/20240601.html',
      date: '2024-06-01',
      category: 'enforcement'
    },
    {
      title: 'マネー・ローンダリング及びテロ資金供与対策の取組と課題（2024年）',
      url: 'https://www.fsa.go.jp/news/r6/20240501/index.html',
      date: '2024-05-01',
      category: 'report'
    },
    {
      title: 'フィンテック・サービスに係る新たな規制の整備に向けた検討について（パブリックコメント）',
      url: 'https://www.fsa.go.jp/news/r6/fintech/20240401.html',
      date: '2024-04-01',
      category: 'public-comment'
    }
  ];
}

/**
 * 金融庁の最新情報を取得してまとめる
 */
async function fetchFSAReports(maxItems = 10) {
  console.log('金融庁ウェブサイトからデータを取得中...');

  const newsItems = await fetchFSANews();
  console.log(`${newsItems.length}件の情報を取得しました`);

  // 各ページの内容を取得（最大maxItems件）
  const reports = [];
  const itemsToFetch = newsItems.slice(0, Math.min(maxItems, newsItems.length));

  for (const item of itemsToFetch) {
    console.log(`取得中: ${item.title.substring(0, 50)}...`);
    const pageContent = await fetchPageContent(item.url);

    reports.push({
      ...item,
      ...pageContent,
      // タイトルは元のリンクテキストを優先
      title: pageContent.title || item.title
    });

    // レート制限回避のための待機
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  return reports;
}

export { fetchFSAReports, fetchFSANews, fetchPageContent, getSampleData };
