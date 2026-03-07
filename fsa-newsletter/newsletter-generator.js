/**
 * newsletter-generator.js
 * Claude APIを使用して金融庁報告書を要約し、
 * 大手法律事務所スタイルのニュースレターを生成する
 */

import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const NEWSLETTER_DATE = new Date().toLocaleDateString('ja-JP', {
  year: 'numeric',
  month: 'long',
  day: 'numeric'
});

/**
 * 法律事務所スタイルのニュースレター生成プロンプト
 */
function buildNewsletterPrompt(reports) {
  const reportsSummary = reports.map((report, index) => `
【報告書 ${index + 1}】
タイトル: ${report.title}
URL: ${report.url}
カテゴリ: ${translateCategory(report.category)}
日付: ${report.date}
内容:
${report.content ? report.content.substring(0, 2000) : '（内容未取得）'}
`).join('\n---\n');

  return `あなたは日本の大手法律事務所のパートナー弁護士です。金融規制・コンプライアンスを専門とし、クライアント（金融機関、上場企業、機関投資家等）向けに質の高いニュースレターを作成することで定評があります。

以下の金融庁の最新発表・報告書に基づいて、プロフェッショナルなニュースレターを作成してください。

【金融庁最新情報】
${reportsSummary}

【ニュースレター作成要件】

1. **形式・スタイル**
   - 大手法律事務所（例：西村あさひ法律事務所、森・濱田松本法律事務所、アンダーソン・毛利・友常法律事務所のスタイル）のニュースレター形式
   - 日本語で作成
   - 簡潔かつ的確な法律専門用語を使用
   - クライアントへの実務的示唆を含む

2. **構成**
   - ヘッダー: 事務所名（仮）、発行日、号数
   - 巻頭言: 今月の金融規制動向の総括（2-3文）
   - 各トピックスの解説:
     * 概要（1-2段落）
     * 法的・規制上の意義
     * 実務上の留意点・対応策
     * 今後の見通し
   - まとめ・総評
   - 免責事項

3. **内容の品質**
   - 単なる事実の羅列ではなく、法的分析と示唆を含める
   - 金融機関・事業会社・投資家等の各ステークホルダーへの影響を明記
   - 必要に応じて関連法令（金融商品取引法、銀行法、保険業法等）を参照
   - 国際的な規制動向との比較も適宜含める

今日の日付: ${NEWSLETTER_DATE}

以下のHTML形式でニュースレターを作成してください。CSSクラスは以下を使用してください:
- .newsletter-header: ヘッダー部分
- .newsletter-meta: 発行情報（事務所名、日付等）
- .foreword: 巻頭言
- .topic-section: 各トピックスのセクション
- .topic-title: トピックスのタイトル
- .topic-summary: 概要
- .legal-significance: 法的意義
- .practical-points: 実務上の留意点
- .outlook: 今後の見通し
- .conclusion: まとめ・総評
- .disclaimer: 免責事項

完全なHTMLコンテンツ（<html>タグは不要、<div class="newsletter">から始めてください）を出力してください。`;
}

/**
 * カテゴリの日本語訳
 */
function translateCategory(category) {
  const translations = {
    'report': '報告書・調査結果',
    'guideline': '監督指針・ガイドライン',
    'enforcement': '行政処分・業務改善命令',
    'public-comment': 'パブリックコメント・意見募集',
    'regulation': '規制改正・告示',
    'alert': '注意喚起',
    'general': '一般情報',
    'press': '新聞発表'
  };
  return translations[category] || category;
}

/**
 * 個別の報告書を簡易要約する（ニュースレター生成前の前処理）
 */
async function summarizeReport(report) {
  if (!report.content || report.content.length < 100) {
    return report;
  }

  const stream = client.messages.stream({
    model: 'claude-opus-4-6',
    max_tokens: 1000,
    thinking: { type: 'adaptive' },
    messages: [{
      role: 'user',
      content: `以下の金融庁の発表・報告書を200字以内で簡潔に要約してください。法的観点から重要なポイントを中心に。

タイトル: ${report.title}
内容:
${report.content.substring(0, 3000)}

要約（日本語、200字以内）:`
    }]
  });

  let summary = '';
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      summary += event.delta.text;
    }
  }

  return { ...report, summary: summary.trim() };
}

/**
 * ニュースレターをストリーミング生成する
 * SSEで結果をリアルタイム送信
 */
async function* generateNewsletterStream(reports) {
  // 報告書が少ない場合やエラー時の処理
  if (!reports || reports.length === 0) {
    yield { type: 'error', message: '処理対象の報告書がありません' };
    return;
  }

  yield { type: 'status', message: 'ニュースレターを生成中...' };

  const prompt = buildNewsletterPrompt(reports);

  const stream = client.messages.stream({
    model: 'claude-opus-4-6',
    max_tokens: 8000,
    thinking: { type: 'adaptive' },
    system: `あなたは日本の大手法律事務所の金融規制専門パートナー弁護士です。
クライアント向けに高品質な金融規制ニュースレターを作成することが得意です。
常に正確で、実務的で、読みやすい文書を作成します。
法律専門家として適切な用語と表現を使用し、クライアントにとって有用な示唆を提供します。`,
    messages: [{
      role: 'user',
      content: prompt
    }]
  });

  let isThinking = false;
  let htmlContent = '';

  for await (const event of stream) {
    if (event.type === 'content_block_start') {
      if (event.content_block.type === 'thinking') {
        isThinking = true;
        yield { type: 'thinking_start' };
      } else if (event.content_block.type === 'text') {
        isThinking = false;
        yield { type: 'content_start' };
      }
    } else if (event.type === 'content_block_delta') {
      if (event.delta.type === 'thinking_delta') {
        yield { type: 'thinking', content: event.delta.thinking };
      } else if (event.delta.type === 'text_delta') {
        htmlContent += event.delta.text;
        yield { type: 'content', content: event.delta.text };
      }
    } else if (event.type === 'content_block_stop') {
      if (isThinking) {
        yield { type: 'thinking_end' };
        isThinking = false;
      }
    } else if (event.type === 'message_stop') {
      yield { type: 'done', totalLength: htmlContent.length };
    }
  }
}

/**
 * ニュースレターを一括生成する（非ストリーミング）
 */
async function generateNewsletter(reports) {
  const prompt = buildNewsletterPrompt(reports);

  const stream = client.messages.stream({
    model: 'claude-opus-4-6',
    max_tokens: 8000,
    thinking: { type: 'adaptive' },
    system: `あなたは日本の大手法律事務所の金融規制専門パートナー弁護士です。
クライアント向けに高品質な金融規制ニュースレターを作成することが得意です。
法律専門家として適切な用語と表現を使用し、クライアントにとって有用な示唆を提供します。`,
    messages: [{
      role: 'user',
      content: prompt
    }]
  });

  const finalMessage = await stream.finalMessage();

  let newsletter = '';
  for (const block of finalMessage.content) {
    if (block.type === 'text') {
      newsletter += block.text;
    }
  }

  return {
    content: newsletter,
    usage: finalMessage.usage,
    generatedAt: new Date().toISOString()
  };
}

/**
 * エラー時のデモニュースレターHTML
 */
function getDemoNewsletter() {
  return `<div class="newsletter">
  <div class="newsletter-header">
    <div class="newsletter-meta">
      <div class="firm-name">法律事務所 金融規制グループ</div>
      <div class="newsletter-title">金融規制ニュースレター</div>
      <div class="issue-info">第1号 ｜ ${NEWSLETTER_DATE}</div>
    </div>
  </div>

  <div class="foreword">
    <h2>巻頭言</h2>
    <p>本ニュースレターは、金融庁の最新の発表・報告書を分析し、クライアントの皆様に実務上の示唆をお届けするものです。今月は、フィンテック規制の動向、マネー・ローンダリング対策の強化、および暗号資産関連の行政処分が注目されます。</p>
  </div>

  <div class="topic-section">
    <div class="topic-header">
      <span class="topic-category">報告書・調査結果</span>
      <h2 class="topic-title">令和6年度 金融行政方針について</h2>
      <div class="topic-date">2024年8月20日</div>
    </div>
    <div class="topic-summary">
      <h3>概要</h3>
      <p>金融庁は、令和6年度の金融行政方針を公表しました。本方針では、デジタル化・グローバル化への対応、金融システムの安定維持、および利用者保護の強化が主要テーマとして掲げられています。</p>
    </div>
    <div class="legal-significance">
      <h3>法的・規制上の意義</h3>
      <p>本方針は行政指導の基本方向を示すものであり、法的拘束力はないものの、金融機関の監督方針・検査方針の基礎となります。特に、フィンテック事業者に対する登録・監督体制の見直しが予告されており、関連事業者は早期に対応を検討する必要があります。</p>
    </div>
    <div class="practical-points">
      <h3>実務上の留意点</h3>
      <ul>
        <li>内部管理体制の整備・見直し（特にサイバーセキュリティ対策）</li>
        <li>顧客保護措置の強化（苦情対応体制の整備）</li>
        <li>ESG・サステナビリティ関連の情報開示対応</li>
        <li>デジタル資産・暗号資産に関連するリスク管理体制の構築</li>
      </ul>
    </div>
    <div class="outlook">
      <h3>今後の見通し</h3>
      <p>令和6年度中に、具体的な監督指針の改正・パブリックコメントが複数実施される見込みです。各金融機関は行政方針の動向を注視し、早期に対応準備を進めることが重要です。</p>
    </div>
  </div>

  <div class="conclusion">
    <h2>まとめ・総評</h2>
    <p>今月の金融庁の動向は、デジタル化対応と利用者保護の両立を強く意識したものとなっています。特に、フィンテック・暗号資産分野における規制の整備が進む中、関連事業者はコンプライアンス体制の見直しを急ぐ必要があります。</p>
    <p>本ニュースレターに関するご質問・ご相談は、当事務所金融規制グループまでお気軽にお問い合わせください。</p>
  </div>

  <div class="disclaimer">
    <p>本ニュースレターは、一般的な情報提供を目的として作成されたものであり、法律上の意見または助言を構成するものではありません。個別の法律問題については、弁護士にご相談ください。本ニュースレターに記載された情報は、作成時点のものであり、その後の法令改正等により変更される場合があります。</p>
  </div>
</div>`;
}

export {
  generateNewsletterStream,
  generateNewsletter,
  summarizeReport,
  getDemoNewsletter,
  translateCategory
};
