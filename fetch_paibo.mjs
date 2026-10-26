// 四站「即将上线」待播池采集 + 每日新定档 diff。
//
// 产出 paibo.json，一页看板读它。四个口全是匿名的：不要账号、不要浏览器、不落任何凭据。
// 只有优酷那一发要按 mtop 的规矩现签一次（头一发换一枚临时票，签完就丢），其余连签名都没有。
// 一轮 28 个固定请求（腾讯 4 + 腾讯即将上线筛选页 4 + 优酷 9 + 芒果首页 2 + 芒果新片日历 2 + 爱奇艺 A 路 3 + 爱奇艺 B 路 2 + 爱奇艺预约数 2），
// 一天两拍 = 56 个固定请求/天。
// ⚠ 另有一笔浮动的：三家有逐条补的数 —— 优酷和腾讯的集数在每部片子自己的详情页（一条一个请求），
//   芒果的预约数和集数在每部片子自己的移动端页（一条两个请求：445 字节的壳 → 真页）。
//   每家每拍最多补 12 条 ⇒ 浮动上限 12×2 + 12 + 12 = 48 个，一轮最多 28+48=76 个、一天最多 152 个。
//   池子铺一遍：腾讯 126 条约 11 拍、优酷 144 条约 12 拍、芒果 51 条约 4 拍，之后每拍只碰新进池的那几条。
//   ⚠ 腾讯那 12 扇门不是从第 1 条开始铺：筛选页独有的那 26 条排在最前（填率 21/26，卡片那一屏只有 8/100），
//     所以前三拍先把它们扫完、页面上靠后那一条也能早点有集数；整池仍旧 11 拍（门数没变），
//     只是卡片那一屏从第九拍推到第十一拍。
//   爱奇艺的集数和预约数本来就在批量路里，一个逐条请求都不花。
//
//   腾讯  POST pbaccess.video.qq.com/.../getPage|getCard   电视剧频道 page_id=100113
//         → coming_soon 那个 tab 整池 100 条（一屏 36，要把它自己回的游标喂回去翻到第三屏 28 才算到底），
//           带精确预约整数 order_person_count
//         POST pbaccess.video.qq.com/trpc.multi_vector_layout.../getMVLPage  筛选页「即将上线」(iyear=1)
//         → 124 条（12+40+40+32，游标同样只能拿它自己回的那一格喂回去），
//           ⚠ 这一路没有预约数、没有集数、没有档期，只有「预约破300万」那种档位文字；
//           它比卡片那一路多 26 条（短剧、二轮剧），那 26 条里 21 条详情页填了集数
//   优酷  GET acs.youku.com/h5/mtop.youku.columbus.gateway.new.execute  片单 22916606「即将上线」
//         → 一页 20 条、八页收完，实测 144 条，带精确预约整数 reserve.count
//         退路是首页 SSR（www.youku.com/ku/webtv）那一屏，只有 20 条；片单不回了才走它
//         集数不在这一路里，在每部片子自己的详情页 GET m.youku.com/alipay_video/id_<showid>.html
//         的 episodeTotal（www 那张同字段、但 38~62 万字节，所以走 m 站那张 6 万的），一条一个请求
//   芒果  两条路并一张单子：
//         ① GET dc.bz.mgtv.com/dynamic/v1/channel/index → module/infos：首页模块 12440 内嵌的 vsubscribe DSL，
//            10 条，带 onlineTime（Unix 秒）—— 屏内次序以这一路为准
//         ② GET playbill.api.mgtv.com/yy/feed?yyId=8|9（新片日历）：一发一整张、不翻页，
//            pbid=8 给 32 条、pbid=9 给 47 条（两张互有交叉，①那 10 条全在 9 里）；
//            ⚠ 这一路的 URL 参数里那串设备标识（did/mac/oaid/seqId）随手编的就是同一份数据，不需要真机号
//            ⚠ 这一路结构上没有预约数，也没有集数（duration 不是集数，实测证伪过）
//         两个数都在逐条那一扇门里：m.mgtv.com/b/<aid> 两跳到 SSR 的 reserveInfo[0].yyNum（精确预约数），
//         同一页里还有 "updateInfo":"共24集，更新至0集" ⇒ 一次敲门拿两个数
//   爱奇艺 A 路 GET pcw-api.iqiyi.com/search/recommend/list?...market_release_date_level=即将上线
//         → 3 页整池（这一家自己会抖：本机 98、线上 94），只有片名/主演/集数/简介
//   爱奇艺 B 路 GET mesh.if.iqiyi.com/portal/lw/videolib/data（要 device_id，见 PAIBO_IQY_DID）
//         → 同一池子里那 40 条，唯一带 showDate 的一路
//   爱奇艺 C 路 GET subscription.iqiyi.com/services/subscribe/countAndState.htm
//         → 预约人数精确整数，subKeys 一次带 60 个 albumId，一个 device_id 都不要
//
// ⚠ 爱奇艺这两条路的 album_id 实测 40/40 完全对得上（B 是 A 的子集，一条新片都不带），
//   所以 B 只拿来补字段，不并池子 —— 98 条还是那 98 条。
//
// ⚠ 日期给的是腾讯、芒果、爱奇艺三家，但三家都不是「排期表」：腾讯和芒果把定档那一刻写进
//   字段（待播的绝大多数仍是空串/0），爱奇艺只在片方真排上档期时才填 showDate，没填的统一占位成 1 月 1 日。
//   优酷那两条路（片单和首页 SSR）一个日期字段都没有：144 条全标 onlineDesc=即将上线，
//   整份回话里 "2026" 只出现在 manufacturingDate 那一格（实测过）。
//   10-25 这一轮爱奇艺 40 条待播里只有 1 条填了真档期（《谜林》10-27）—— 这是常态不是故障。
//
// ⚠ 预约数四家都给得出精确整数（腾讯 order_person_count / 优酷 reserve.count / 芒果 yyNum /
//   爱奇艺 countAndState）。10-25 之前这份脚本按「爱奇艺只给『预约破300万』这种档位」写的，
//   那个口径是错的：档位文字是 B 路的另一个字段，独立的一个口一直存在，只是没找着。
//   档位文字仍然留在 hot 里当 C 路断掉时的退路，页面只在拿不到整数时印它。
//   那四个整数各数各的站内计数，口径仍不通用，所以不跨站比大小，只在站内各排各的。
//
// ⚠ 集数四家都给得出，但填了多少差得很远（10-26 把两家的整池逐条打过）：
//   爱奇艺在 A 路的 videoCount（98 条里 96 条有数，白拿）；芒果在预约数那一页的 updateInfo
//   「共N集，更新至M集」（原有 10 条里 9 条有数，唯一没有的那条是电影、它写的是「更新至0期」）；
//   优酷在每部片子自己的详情页 episodeTotal、腾讯在每部片子自己的详情页 episode_all。
//   后三家一条一次敲门（芒果那一门两个请求），实测填充率优酷约三成、腾讯 8/100 ——
//   所以各按每拍 12 扇门铺，问过没给的记下 0 不再敲第二遍（刚定档的那一条会重新敲，那是平台改口集数的时候）。
//   页面上这一列印的是「N 集」，谁没给就空着，不拿别家的数顶，也不拿 0 印成「0 集」。
//
// 历史为什么必须自己攒：四个口都只回「当前」这一屏，没有更深的历史接口。
// 哪天定档、哪天进池、哪天被撤，只有这个文件里留着。所以它是「读旧-追加-写新」，
// 和 billboard.json 一样，谁也不能把别人攒的那几格覆盖掉。
//
// 环境变量：
//   PAIBO_OUT      产出路径，默认 paibo.json
//   PAIBO_KEEP     diff 最多留多少个自然日，默认 60
//   PAIBO_PROBE    1 = 取数、打印、不写文件（用来验 Actions 的机房 IP 能不能取到数）
//   PAIBO_IQY_DID  爱奇艺 B 路要的 device_id（每台浏览器一个的设备标识，31 位小写字母数字）。
//                  ⚠ 只走环境变量 + 仓库 Secret：绝不写进代码正文、绝不提交、绝不打进日志。
//                  没给就整段跳过 B 路 —— 爱奇艺那一格照常回整池、照常带预约人数，只是没有定档日。

import fs from 'node:fs';
import crypto from 'node:crypto';

const md5 = s => crypto.createHash('md5').update(s).digest('hex');

const OUT = process.env.PAIBO_OUT || 'paibo.json';
const KEEP = Number(process.env.PAIBO_KEEP) || 60;
const PROBE = process.env.PAIBO_PROBE === '1';
const IQ_DID = String(process.env.PAIBO_IQY_DID || '').trim();
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const MS = 25000;

export const PLATFORMS = {
  qq: { name: '腾讯视频', hasDate: true, hasCount: true },
  yk: { name: '优酷', hasDate: false, hasCount: true },
  mg: { name: '芒果TV', hasDate: true, hasCount: true },
  iq: { name: '爱奇艺', hasDate: true, hasCount: true },
};

/* 日期串一律自己拼 YYYY-MM-DD：拿 Intl 按 locale 直接 format，小 ICU 会退回 09/20/2026。
   这台机器和 Actions runner 的本地时区不是一个东西，所以按北京时区取字段，不读系统时钟格式。 */
const p2 = n => String(n).padStart(2, '0');
const bjParts = d => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Shanghai', hour12: false,
  year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
}).formatToParts(d).reduce((a, x) => (a[x.type] = x.value, a), {});
export const bjStamp = d => { const p = bjParts(d);
  return `${p.year}-${p2(p.month)}-${p2(p.day)} ${p2(p.hour)}:${p2(p.minute)}`; };
const bjDay = d => bjStamp(d).slice(0, 10);

async function get(url, opt = {}) {
  const r = await fetch(url, { ...opt, signal: AbortSignal.timeout(MS) });
  return { status: r.status, body: await r.text() };
}

/* 拿不到数就返回 {ok:false,msg}，main 里据此保住上一轮的池子。
   绝不因为「这一家今天抖了一下」就把整家印成 0 条 —— 那在 diff 里会长成「今天撤了 36 部」。 */

// ---------- 腾讯 ----------
// getPage 漏 page_bypass_params 只回 18 字节的 {"ret":0,"msg":""}，看着像成功、其实是空的。
// tab_mvl_sub_mod_id 和 flip_infos.change 每次加载都变，必须从 getPage 现读，不能写死。
/* ⚠ 第十五遍曾在这一行判「腾讯的集数不接」，那一版错了两处，都留着当反面教材：
   一是把只读了第一屏的 36 条当成整池。翻页不是改 page_index（给它 2、3 都还是那 36 条），
     是把 getCard 自己回的那一格 flip_infos.change 原样喂回去 —— 整池 100 条 = 36 + 36 + 28，
     翻到第 100 条它会绕回第一屏，所以「本页比第一屏少」或「一个新人没有」就是到底了。
   二是拿第一屏那 36 条算填充率。100 条逐条打过详情页：8 条填了集数
     （风生水起 24／凤舞九天 40／魂判九川 24／大路朝东 44／坠入夜色的他 24／花间酒人间月 24／变局 30／向明月许愿 16），
     前 36 条里只有 1 条 —— 另外 7 条全在池子后半截，第一屏根本望不见。
   字段一直是那一个：详情页 getPage(scene=desk_detail) 回来的 pc_introduction 卡 params.episode_all，匿名、无票、一条一请求。
   8/100 换 100 个请求值不值？按「每拍敲 12 扇门、问过就记下」铺：一遍 11 拍（池子已经并上筛选页那 126 条），
   铺完之后每拍只碰新进池的那几条 ⇒ 一次性代价，所以接。
   ⚠ 同一个问题 10-26 又在筛选页那一路上量了一遍：卡片池没给的 26 条里 21 条填了集数 ——
     填的全是短剧和二轮剧（北境往事 24／济公4 24／绝顶 42／繁华落尽第二季 24…），
     它们根本不在 coming_soon 那一屏里，所以那一屏望不见不代表没有。
   两条还成立的实测：网页那张详情页 HTML 本身是 Vue 空壳（187 KB 里没有片名、没有「集」），别去刮；
   腾讯把「还没填」写成空串（不是 0），空串同样当「问过了」记下。 */
const QQ_API = 'https://pbaccess.video.qq.com/trpc.vector_layout.page_view.PageService/';
const QQ_Q = '?video_appid=3000010&vversion_platform=2';
const QQ_H = { 'content-type': 'application/json', 'user-agent': UA,
  'referer': 'https://v.qq.com/channel/tv', 'origin': 'https://v.qq.com' };
const qqRid = () => [...Array(16)].map(() => (Math.random() * 16 | 0).toString(16)).join('');
async function qqPost(path, body) {
  const r = await get(QQ_API + path + QQ_Q, { method: 'POST', headers: QQ_H, body: JSON.stringify(body) });
  try { return JSON.parse(r.body); } catch (e) { return null; }
}
/* ---------- 腾讯第二条路：App 端「电视剧 → 筛选 → 即将上线」那张列表 ----------
   上面那一一路（coming_soon 卡片）给的是数，这一路给的是全。10-26 实测，全程不带 cookie：
   · filter_params 里 iyear=1 就是筛选页上那个「即将上线」，sort=75 是「最热」。
     它这个「最热」不是按预约数排的（124 条对着卡片池里的预约整数数，52 处逆序），所以次序不能当数用。
   · 一屏默认 12 条；page_context 里那把 *_poster_size 写 40 就真给 40 条 ⇒ 四屏收完 124 条
     （12+40+40+32，第四屏 has_next_page=false）。和卡片那一路一样是 4 发。
   · 那把钥匙的名字（_ds_cli_<16 个十六进制>_）我们自己编不出来：给它一个全零的假名，
     它当没看见、按默认 12 条回；它回的那一格 page_context 里带着真名 ⇒ 只能拿它自己回的喂回去。
     这一条和卡片那一路的 flip 游标是同一个规矩，别改成写死。
   · ⚠ 这一路一条集数都不给：45 个字段里没有，publish_date 124 条全空；也没有 order_person_count。
     它给的是「预约破300万」那种档位文字（third_title_type=10 那一格），所以 count 留 null、页面印档位。
   · 和卡片池对着数：卡片 100 条里 98 条这里也有，这里另多出 26 条（短剧、二轮剧都在这 26 条里，
     含《北境往事》《济公4》《绝顶》）。那 26 条逐条敲详情页：21 条填了集数 ——
     卡片那 100 条只有 8 条填。集数还是得靠逐条那一扇门，但这一路把「该敲谁」的名单扩到 124。
   ⚠ 头不能少：去掉 origin/referer 它回 ret=20607、一条不给（是被拒，不是空池子）。
      桌面 UA、不带 vb-request-tag 那些 App 私有头照样给数据。 */
const QQ_LIST = 'https://pbaccess.video.qq.com/trpc.multi_vector_layout.mvl_controller.MVLPageHTTPService/getMVLPage'
  + '?&vversion_platform=2';
const QQ_LIST_PP = { channel_id: '100113',
  filter_params: 'sort=75&itype=-1&ipay=-1&iarea=-1&iyear=1&theater=-1&award=-1&recommend=-1',
  page_type: 'operation', page_id: 'channel_list' };
const QQ_LIST_SIZE = '40';
const QQ_LIST_PAGE_MAX = 6;                       // 实测 4 屏到底，留两屏余量
async function qqListPost(body) {
  const r = await get(QQ_LIST, { method: 'POST', headers: QQ_H, body: JSON.stringify(body) });
  try { return JSON.parse(r.body); } catch (e) { return null; }
}
// 档位文字有两个落点，优先那一个明确标了 type=10 的；chnlist_search_label 里 category 10 是同一条。
export function qqTier(p) {
  if (String(p.third_title_type) === '10' && p.third_title) return String(p.third_title);
  try {
    for (const l of JSON.parse(p.chnlist_search_label || '[]')) if (l.category === 10 && l.label) return String(l.label);
  } catch (e) { /* 那一格偶尔不是合法 JSON */ }
  return '';
}
// 这一路的 sub_title 是主演（空格分隔），second_title 才是那句宣传语 —— 和卡片那一路正好反着。
// ⚠ 124 条实测 type/item_type 全是 '2'（剧集），因为这张列表就是电视剧频道的；同一个字段名在
//   nav_card 那八张卡上是「频道 id」。所以别顺手把 filter_params 改成别的频道 —— 改了就混进电影，
//   而这一路没有类目字段可以拦（真到那一步要按 type 拦，并在注记里报拦掉几条）。
export function qqListItem(p) {
  if (!p || !p.title || !p.cid) return null;
  return {
    id: 'qq:' + p.cid, platform: 'qq', title: String(p.title),
    genre: String(p.main_genre || ''),
    cast: String(p.sub_title || '').replace(/[[\]]/g, ' ').trim().split(/\s+/).filter(Boolean).join('、'),
    line: String(p.second_title || ''), count: null, hot: qqTier(p),
    date: null, time: null, dateText: '', eps: null,
    pic: httpsPic(p.new_pic_vt || p.new_pic_hz),
    url: 'https://v.qq.com/detail/' + String(p.cid).charAt(0) + '/' + p.cid + '.html',
  };
}
export function qqListCards(j) {
  return (((((((j || {}).data || {}).modules || {}).normal || {}).cards || [])[0] || {}).children_list || {}).poster_card || {};
}
/* 两条路并一张单子：卡片那一路排在前面 —— pos 认的是 coming_soon 那一屏的次序，
   而且只有那一路带精确预约数和档期。筛选页独有的那些条追在后面。
   传进来的数组不许被改写（外面还指着它算卡片条数）。 */
export function mergeQq(cardItems, listItems) {
  const out = cardItems.slice();
  const has = new Set(out.map(x => x.id));
  const only = new Set();
  let added = 0;
  for (const x of listItems) if (!has.has(x.id)) { out.push(x); has.add(x.id); only.add(x.id); added++; }
  /* only 交给集数那一队当「先敲这些」的名单 —— 这一路独有的条填率 21/26，卡片那一屏只有 8/100。 */
  return { items: out, added, only };
}
async function qqList() {
  const out = [];
  let ctx = {}, dead = 0;
  for (let pg = 0; pg < QQ_LIST_PAGE_MAX; pg++) {
    const j = await qqListPost({ page_params: QQ_LIST_PP, page_context: ctx });
    const d = (j || {}).data;
    /* 抖一发不算这一路挂：连着两发没回话才收摊（保住已经收到的那几十条）。 */
    if (!d || j.ret !== 0) { dead++; if (dead >= 2) break; continue; }
    dead = 0;
    const arr = qqListCards(j).cards || [];
    const has = new Set(out.map(x => x.id));
    for (const x of arr) {
      const it = qqListItem(x.params);
      if (it && !has.has(it.id)) { out.push(it); has.add(it.id); }
    }
    if (!d.has_next_page || !arr.length) break;
    ctx = d.page_context || {};
    for (const k of Object.keys(ctx)) if (/_poster_size$/.test(k)) ctx[k] = QQ_LIST_SIZE;
  }
  return out;
}
async function fetchQQ(prevItems) {
  const PP = { page_type: 'channel', page_id: '100113', scene: 'channel', new_mark_label_enabled: '1' };
  const page = await qqPost('getPage', { page_params: PP,
    page_bypass_params: { params: { platform_id: '2', caller_id: '3000010', data_mode: 'default',
      user_mode: 'default', specified_strategy: '', ...PP },
      scene: 'channel', app_version: '', abtest_bypass_id: qqRid() } });
  const mods = ((page || {}).data || {}).CardList;
  if (!Array.isArray(mods)) return { ok: false, msg: 'getPage 没回模块（多半是漏了 page_bypass_params 或被掐）' };
  const out = [];
  let tabs = 0;
  for (const c of mods) {
    let tl = [];
    try { tl = JSON.parse((c.params || {}).multi_tab || '[]'); } catch (e) { continue; }
    for (const t of tl) {
      if (t.tab_type !== 'coming_soon') continue;
      tabs++;
      if (tabs > 2) continue;                       // 上游哪天多开一个 tab 也不至于打满请求
      /* 一个 tab 最多翻 4 屏（实测 3 屏到底）。第二屏往后用的是上一屏自己回的那一格游标。 */
      let flip = (c.flip_infos || {}).change, size = 0;
      const seen = new Set();
      for (let pg = 0; pg < 4 && flip; pg++) {
        const res = await qqPost('getCard', {
          page_params: { tab_mvl_sub_mod_id: t.tab_mvl_sub_mod_id, tab_name: t.tab_name, tab_type: t.tab_type,
            page_id: 'scms_shake', page_type: 'scms_shake', source_key: '', tag_id: '', tag_type: '',
            new_mark_label_enabled: '1' },
          page_context: { page_index: '1' },
          flip_info: flip });
        const card = ((res || {}).data || {}).card || {};
        const arr = (((card.children_list || {}).list || {}).cards) || [];
        if (!size) size = arr.length;
        const before = seen.size;
        for (const x of arr) {
          const p = x.params || {};
          if (!p.title || !p.cid || seen.has(p.cid)) continue;
          seen.add(p.cid);
          const d = qqDate(p.online_time);
          out.push({
            id: 'qq:' + p.cid, platform: 'qq', title: String(p.title),
            genre: qqGenre(p.topic_label), cast: qqCast(p.topic_label),
            line: String(p.sub_title || ''), count: num(p.order_person_count), hot: '',
            date: d.date, time: d.time, dateText: d.text, eps: null,
            pic: httpsPic(p.priority_image_url || p.image_url),
            url: 'https://v.qq.com/detail/' + String(p.cid).charAt(0) + '/' + p.cid + '.html',
          });
        }
        if (!arr.length || arr.length < size || seen.size === before) break;
        flip = (card.flip_infos || {}).change;
      }
    }
  }
  if (!tabs) return { ok: false, msg: '电视剧频道里没有 coming_soon 这个 tab（上游改了模块结构）' };
  if (!out.length) return { ok: false, msg: 'coming_soon tab 找到了但一条都没解析出来' };
  /* 卡片那一路排在前（它带精确预约整数和档期），筛选页独有的那些条追在后面。 */
  const cardCount = out.length;
  const listItems = await qqList();
  const m = mergeQq(out, listItems);
  const items = dedupe(m.items);
  const s = await fillEps(items, prevItems, qqEps, m.only);
  return { ok: true, items,
    note: `单子：待播卡片 ${cardCount} 条 + 即将上线筛选页 ${listItems.length} 条 → 新增 ${m.added} 条；`
      + `集数：这一拍敲了 ${s.asked} 扇门、其中 ${s.ahead} 扇先给筛选页那一路（它独有的那些条腾讯填得最勤）、`
      + `腾讯填了 ${s.got} 部`
      + `（它自己留空的 ${s.blank} 部不再敲第二遍）、沿用上一轮 ${s.carried} 条` };
}
// topic_label 形如「爱情|陈飞宇|张子枫」：第一段是类型，后面是主演。上游不给分开的字段。
const qqSplit = s => String(s || '').split('|').map(x => x.trim()).filter(Boolean);
const qqGenre = s => qqSplit(s)[0] || '';
const qqCast = s => qqSplit(s).slice(1).join('、');
// online_time 是「2026-10-31 10:00:00」这种整串；待播的绝大多数是空串 —— 空串就是还没定档，
// 不是缺字段。腾讯这个字段在电影频道那条定档的片子身上确实填了值，所以判定成立。
export function qqDate(s) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(String(s || '').trim());
  if (!m) return { date: null, time: null, text: '' };
  const date = `${m[1]}-${p2(Number(m[2]))}-${p2(Number(m[3]))}`;
  const time = m[4] ? `${p2(Number(m[4]))}:${p2(Number(m[5] || 0))}` : null;
  return { date, time, text: time ? `${date} ${time}` : date };
}

// ---------- 优酷 ----------
/* 优酷的「即将上线」有两个口，给的不是同一批片子：
     · 首页 SSR（__INITIAL_DATA__）里那条横排 —— 只有 20 条；
     · 鼠标移到那一行上、点「查看全部」弹出来的那一层 —— 是一张片单（scg 22916606），
       走 mtop.youku.columbus.gateway.new.execute，一页 20 条、八页收完，实测 144 条。
   两路口径完全一致（144 条的前 20 条和首页那 20 条一字不差、顺序也一样，预约数对得上），
   片单还多带 desc 和 tags，所以主路走片单，SSR 那条留着当退路。
   ⚠ 这一家一个日期字段都没有：144 条全标 onlineDesc=即将上线 / reason=敬请期待，
     整份回话里 "2026" 只出现在 manufacturingDate 那一格。
   全匿名：只要一枚现签的 _m_h5_tk，不要 cookie、不要账号。 */
const YK_API = 'mtop.youku.columbus.gateway.new.execute';
const YK_APPKEY = '24679788';
const YK_MS = '2019041100';
const YK_SCG = '22916606';
const YK_MAXPAGE = 12;   // 实测第 8 页 more:false 收尾，留四页余量；余量只在它变长时才用得上

// mtop h5 的两步握手：头一发故意签错，只为换一枚 _m_h5_tk；第二发才是真请求。
// 这一枚 token 在一轮里八页共用，所以整条路是 9 发而不是 16 发。
let ykTk = '', ykCookie = '';
async function ykCall(pageNo, session) {
  const data = JSON.stringify({
    ms_codes: YK_MS,
    params: JSON.stringify({
      debug: 0, appPackageKey: 'com.youku.pcweb', appPackageId: 'com.youku.pcweb',
      ip: '127.0.0.1', reqSubNode: 0, gray: '0', pageNo, bizKey: 'kuflix_node_page',
      showNodeList: 0, nodeKey: 'PIANDAN_HEATLIST', appKey: YK_APPKEY,
      ...(session ? { session: JSON.stringify(session) } : {}),
      bizContext: JSON.stringify({ entityId: Number(YK_SCG), entityType: 'scg' }),
    }),
    system_info: JSON.stringify({
      appPackageKey: 'com.youku.pcweb', appPackageId: 'com.youku.pcweb',
      device: 'pcweb', os: 'pcweb', ver: '1.0.0.0', userAgent: UA,
      young: 0, appkey: YK_APPKEY, disableUserRec: '0',
    }),
  });
  let last = null;
  for (let i = 0; i < 3; i++) {
    const t = String(Date.now());
    const sign = md5(`${ykTk}&${t}&${YK_APPKEY}&${data}`);
    const q = new URLSearchParams({
      jsv: '2.6.1', appKey: YK_APPKEY, t, sign, api: YK_API, v: '1.0',
      type: 'originaljson', dataType: 'json', data,
    });
    const headers = { 'user-agent': UA, referer: 'https://www.youku.com/', accept: 'application/json' };
    if (ykCookie) headers.cookie = ykCookie;
    const r = await fetch(`https://acs.youku.com/h5/${YK_API}/1.0/?${q}`,
      { headers, signal: AbortSignal.timeout(MS) });
    const raw = await r.text();
    try { last = JSON.parse(raw); } catch (e) { last = { ret: ['BAD_JSON'] }; }
    if ((last.ret || []).some(x => String(x).includes('SUCCESS'))) return last;
    const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    for (const c of sc) {
      const kv = c.split(';')[0];
      if (!/_m_h5_tk(_enc)?=/.test(kv)) continue;
      ykCookie = ykCookie ? `${ykCookie}; ${kv}` : kv;
      const m = /^_m_h5_tk=([^_;]+)/.exec(kv);
      if (m) ykTk = m[1].split('_')[0];
    }
    if (!ykTk) break;   // 连 token 都没给，再转两圈也是白转
  }
  throw new Error('签名或回话不对：' + JSON.stringify((last && last.ret) || '?'));
}

// 页面上那一层是「组件 → 条目」两棵树，层级会随版本漂，所以递归找、不写死路径。
const ykGrab = (x, acc = []) => {
  if (!x || typeof x !== 'object') return acc;
  if (x.title && x.reserve && x.reserve.count !== undefined && x.reserve.id) acc.push(x);
  for (const v of Object.values(x)) if (v && typeof v === 'object') ykGrab(v, acc);
  return acc;
};
const ykComps = (x, acc = []) => {
  if (!x || typeof x !== 'object') return acc;
  if (x.data && x.data.session && Array.isArray(x.nodes)) acc.push(x);
  for (const v of Object.values(x)) if (v && typeof v === 'object') ykComps(v, acc);
  return acc;
};

async function fetchYKPool() {
  const out = [];
  let session = null, pages = 0;
  try {
    for (let p = 1; p <= YK_MAXPAGE; p++) {
      const r = await ykCall(p, session);
      const root = (r.data || {})[YK_MS];
      const items = ykGrab(root);
      if (!items.length) break;
      pages++;
      out.push(...items);
      const comps = ykComps(root.data || root);
      const more = comps.length ? comps.some(c => c.more) : false;
      session = comps.length ? comps[0].data.session : null;
      if (!more || !session) break;
    }
  } catch (e) { return { ok: false, msg: e.message }; }
  const mapped = out.map(x => ({
    id: 'yk:' + x.reserve.id, platform: 'yk', title: String(x.title),
    genre: ykGenre(x.tags), cast: '',
    line: String(x.desc || '').replace(/\s+/g, '').slice(0, 60),
    count: num(x.reserve.count), hot: '',
    date: null, time: null, dateText: '', eps: null,
    pic: httpsPic(x.img || x.hImg),
    url: 'https://www.youku.com/show/id_' + x.reserve.id + '.html',
  }));
  if (mapped.length < 20) return { ok: false, msg: `片单只回了 ${mapped.length} 条，比平时（144 条）少太多，这一轮不用` };
  return { ok: true, items: dedupe(mapped),
    note: `片单那一路：${pages} 页 ${mapped.length} 条（「查看全部」点开的那一张，含首页横排那 20 条）` };
}

// 退路：首页 SSR 那一屏，20 条。__INITIAL_DATA__ 那坨里有裸的 undefined（"PUM":undefined），
// JSON.parse 直接炸；而且它后面还跟着分号和别的语句，所以要自己按括号配平截一刀。
async function fetchYKStrip() {
  const r = await get('https://www.youku.com/ku/webtv', { headers: { 'user-agent': UA } });
  const s = r.body || '';
  const at = s.indexOf('__INITIAL_DATA__');
  if (at < 0) return { ok: false, msg: `页面里没有 __INITIAL_DATA__（${s.length} 字节，多半被挡了）` };
  const eq = s.indexOf('{', at);
  const raw = balance(s.slice(eq));
  let j;
  try { j = JSON.parse(raw.replace(/\bundefined\b/g, 'null')); }
  catch (e) { return { ok: false, msg: '解析不了 __INITIAL_DATA__：' + e.message }; }
  const root = j.data || j;
  let comp = null;
  for (const m of root.moduleList || []) {
    for (const c of m.components || []) {
      if (String(c.title || '').indexOf('即将上线') >= 0) { comp = c; break; }
    }
    if (comp) break;
  }
  if (!comp) return { ok: false, msg: '找到了 INITIAL_DATA 但没有「即将上线」组件' };
  const out = [];
  for (const it of comp.itemList || []) {
    if (!it.title || !it.action_value) continue;
    out.push({
      id: 'yk:' + it.action_value, platform: 'yk', title: String(it.title),
      genre: ykGenre(it.tags), cast: '',
      line: String(it.desc || '').slice(0, 60),
      count: num((it.reserve || {}).count), hot: '',
      date: null, time: null, dateText: String(it.subtitle || ''), eps: null,
      pic: httpsPic(it.hImg || it.img),
      url: 'https://www.youku.com/show/id_' + it.action_value + '.html',
    });
  }
  if (!out.length) return { ok: false, msg: '「即将上线」组件是空的' };
  return { ok: true, items: dedupe(out) };
}

/* 优酷和腾讯这两家的集数不在待播那一路里，各在每部片子自己的详情页上，一家一个字段：
   优酷 "episodeTotal"（www 那张页 38~62 万字节，m 站同一部片子 6 万字节、同一个字段 ⇒ 走 m 站）；
   腾讯 详情页 getPage 的 pc_introduction 卡 params.episode_all（一条 6~11 万字节）。
   ⚠ 一部一个请求 ⇒ 池子 126/144 部全取一遍就是 126/144 个请求，比固定那 28 个还多。
      所以每家每拍各只补「还没有数」的前 EPS_MAX 条，按站内次序 —— 靠前的正是页面上先看见的。
      铺满一遍：腾讯约 11 拍、优酷约 12 拍，之后每拍只碰新进池的那几条。
   ⚠ 腾讯这一家把「筛选页独有的那几条」提到队列最前（它独有的 26 条填了 21 条，卡片那一屏 100 条只填 8 条）：
      按站内次序排要第九拍才轮到它们，等于那 21 个数字白等多六天。⇒ 前三拍基本全砸在筛选页那一路，
      页面上那 26 条（pos 101 往后）会先有集数、卡片那一屏反倒后有。整池那 126 条仍旧 11 拍铺完（门数没变，只是先后调了个过），
      代价是卡片那一屏自己从第九拍推到第十一拍 —— 那一屏填率本来就低，多等的两拍里压着的数没几个。
   ⚠ 「这一家自己没填」两家写法不同：优酷是 "episodeTotal":0，腾讯是空串。两个都归成 eps=0
      留下（页面拿不到就不印），不然每拍都在重敲同一批没人接的电话。
   ⚠ 代价摆在这里：一条现在写 0 的片子，平台后来改口公布了集数，光靠「问过一次」是看不见的。
      改口基本发生在定档那一刻 ⇒ 上一拍还没档期、这一拍有了，就把那个 0 放回「没问过」重新排队。
      没定档的那些不重敲，那是 100 个请求换 8 个数的那笔账。 */
const EPS_MAX = 12;
export function carryEps(items, prevItems) {
  /* 待播那一路整条就没有集数这个字段 ⇒ 它是「没问过」，不是「没有」。
     所以旧值必须原样带过来，不许被这一轮的空覆盖 —— 和爱奇艺档期那一条是同一个道理。 */
  const prev = new Map((prevItems || []).map(x => [x.id, x]));
  let kept = 0;
  for (const x of items) {
    const p = prev.get(x.id);
    if (!p) continue;
    if (x.eps == null) { if (p.eps != null) { x.eps = p.eps; kept++; } }
    else if (x.eps === 0 && p.eps === 0 && x.date && !p.date) x.eps = null;
  }
  return kept;
}
/* first 是「这一拍先敲哪几条」的名单：不在名单里的仍按站内次序排在后面。
   腾讯传的只有筛选页那一路独有的条 —— 它自己那 26 条填了 21 个，卡片那一屏 100 条只填 8 个，
   每拍 12 扇门按站内次序敲要第九拍才轮到它们，那 21 个数字白白多等六天。 */
export function pickEps(items, max, first) {
  const todo = items.filter(x => x.eps == null);
  if (!first || !first.size) return todo.slice(0, max);
  const head = todo.filter(x => first.has(x.id));
  return head.concat(todo.filter(x => !first.has(x.id))).slice(0, max);
}
async function ykEps(x) {
  try {
    const r = await get(`https://m.youku.com/alipay_video/id_${x.id.slice(3)}.html`,
      { headers: { 'user-agent': MG_UA, referer: 'https://m.youku.com/' } });
    const m = /"episodeTotal":(\d+)/.exec(r.body || '');
    return m ? Number(m[1]) : null;
  } catch (e) { return null; }
}
async function qqEps(x) {
  const j = await qqPost('getPage', {
    page_params: { ad_wechat_authorization_status: '0', req_from: 'web_vsite', ad_exp_ids: '', pc_sdk_version: '',
      pc_oaid: '', new_mark_label_enabled: '1', pc_device_info: '', support_pc_yyb_mobile_app_engine: '0',
      pc_wegame_version: '', cid: x.id.slice(3), history_vid: '', vid: '', is_pc_new_detail_page: '0',
      is_from_web_flyflow: '1', lid: '' },
    page_bypass_params: { params: { caller_id: '3000010', platform_id: '2' },
      scene: 'desk_detail', app_version: '', abtest_bypass_id: qqRid() },
    page_context: {} });
  for (const m of ((((j || {}).data || {}).CardList) || [])) for (const g of Object.values(m.children_list || {}))
    for (const c of (g.cards || [])) if (c.type === 'pc_introduction') {
      const v = String((c.params || {}).episode_all || '').trim();
      return v === '' ? 0 : (Number(v) || 0);        // 空串 = 腾讯自己没填，也算问过了
    }
  return null;                                       // 连简介卡都没有 ⇒ 当没敲过，下一拍再试
}
async function fillEps(items, prevItems, epsOf, first) {
  const carried = carryEps(items, prevItems);
  const todo = pickEps(items, EPS_MAX, first);
  let got = 0, blank = 0;
  for (let i = 0; i < todo.length; i += 4) {
    const rs = await Promise.all(todo.slice(i, i + 4).map(epsOf));
    rs.forEach((n, k) => { const x = todo[i + k];
      if (n == null) return;
      x.eps = n;
      if (n > 0) got++; else blank++; });
  }
  return { carried, asked: todo.length, got, blank,
    ahead: first && first.size ? todo.filter(x => first.has(x.id)).length : 0 };
}

async function fetchYK(prevItems) {
  const pool = await fetchYKPool();
  let r;
  if (pool.ok) r = pool;
  else {
    const strip = await fetchYKStrip();
    if (!strip.ok) return { ok: false, msg: `片单：${pool.msg}；首页那一屏也没接上：${strip.msg}` };
    strip.note = `片单那一路没回话（${pool.msg}），这一轮退回首页那一屏那 ${strip.items.length} 条`;
    r = strip;
  }
  const s = await fillEps(r.items, prevItems, ykEps);
  r.note = `${r.note ? r.note + '；' : ''}集数：这一拍敲了 ${s.asked} 扇门、优酷填了 ${s.got} 部`
    + `（它自己写着 0 的 ${s.blank} 部不再敲第二遍）、沿用上一轮 ${s.carried} 条`;
  return r;
}

// tags 第一位是「预告」这种状态标，后面才是类型；实测每条形如 ["预告","悬疑 · 罪案"]。
export function ykGenre(tags) {
  const arr = (tags || []).map(t => (t && t.text && t.text.title) || (t && t.text) || t).filter(Boolean)
    .map(s => String(s).trim());
  return arr.filter(s => s !== '预告').join(' · ');
}
export function balance(str) {
  let d = 0, inS = false, esc = false;
  for (let k = 0; k < str.length; k++) {
    const c = str[k];
    if (inS) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inS = false; continue; }
    if (c === '"') inS = true;
    else if (c === '{' || c === '[') d++;
    else if (c === '}' || c === ']') { d--; if (d === 0) return str.slice(0, k + 1); }
  }
  return str;
}

// ---------- 芒果 ----------
// 两条路并成一张单子：
// ① 首页 channelId=5 的模块 12440（十来条，混在 DSLList 中间靠 moduleType==='vsubscribe' 认，
//    不在 /tv/ 频道）—— 这一路给的是**屏内次序**，页面上先看见的就是它排在前面的。
// ② 新片日历 playbill.api.mgtv.com/yy/feed（他 10-26 给的这一发）—— pbid=8 回 32 条、pbid=9 回 47 条，
//    两张互有交叉（模块那 10 条 10/10 都在 9 里，8 里另有 4 条 9 里没有）⇒ 两发都要、按 aid 去重。
/* ⚠ 这一发的 page / pageNum / pageSize / limit / type 全不起作用（实测五种写法回的是同一份 31,184 字节），
      一张单子一次给完，不许照着「翻页」写个循环空转。
   ⚠ 单子结构上**没有预约数**（一条 16 个字段摊开看过：img/imgHor/title/onlineText/status/info/tag/stag/
      duration/onlineTime/calendarName/jumpKind/jumpId/childId/jumpUrl/tvChannelId/streamId）
      ⇒ 「没问过 ≠ 没有」这一条对 count 同样成立，旧的 count 必须 carry 过来，不许被这一路的空盖掉。
   ✅ 它 URL 上那串 did / mac / oaid / seqId **随手编一个就是同一份数据**（实测编一条 32 位十六进制，
      回话字节数、条数、片名一片不差）⇒ 不需要任何真机标识，不进仓库、不建 secret。
      代码里那串是每次运行现编的，跟腾讯那个 visitor id、这一家原本就在用的 mkUuid() 同一个性质。
   ⚠ duration **不是集数**（证伪两次：咸鱼飞升库里 40 集、这一路写 17；灿烂如野 24 集、写 92），
      这一路不许拿它当集数用，也不给它起个「共 N 集」的名字。
   ⚠ 这一路的 onlineTime 32 条里只填了 1 条 ⇒ 它不比模块那一路多给档期，接它纯粹是为了那 40 来条片子。 */
const MG_PBIDS = ['8', '9'];
const MG_DOOR_MAX = 12;
const MG_APP_UA = 'Mozilla/5.0 (Linux; Android 12; M2006J10C) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Mobile Safari/537.36';
const mgHex = (n) => [...Array(n)].map(() => (Math.random() * 16 | 0).toString(16)).join('');
export function mgFeedItem(x) {
  const i = (x || {}).info || {};
  if (!i.title || !x.aid) return null;
  const ts = Number(i.onlineTime) || 0;
  let date = null, time = null;
  if (ts > 0) { const p = bjParts(new Date(ts * 1000)); date = `${p.year}-${p2(p.month)}-${p2(p.day)}`; time = `${p2(p.hour)}:${p2(p.minute)}`; }
  return {
    id: 'mg:' + x.aid, platform: 'mg', title: String(i.title),
    genre: (i.tag || []).join(' · '), cast: '',
    line: String(i.info || '').replace(/\s+/g, '').slice(0, 60),
    count: null, hot: '', date, time, dateText: String(i.onlineText || ''), eps: null,
    pic: httpsPic(i.imgHor || i.img || ''),
    url: `https://www.mgtv.com/b/${x.aid}`,
  };
}
async function mgPlaybill(pbid) {
  const did = mgHex(32);
  const q = new URLSearchParams({
    _support: '10100001', device: 'M2006J10C', osVersion: '12', appVersion: '9.0.6',
    androidPatch: '9.0.6', ticket: '', userId: '0', did, mac: did, osType: 'android',
    channel: 'xiaomi', uuid: '', endType: 'mgtvapp', oaid: mgHex(16), ageMode: '0',
    seqId: mgHex(32), version: '5.2', type: '10', abroad: '0', src: 'mgtv', uid: '',
    phonetype: 'M2006J10C', testversion: '', allowedRC: '1', mf: 'Xiaomi', brand: 'Redmi',
    page: '1', yyId: pbid });
  const r = await get(`https://playbill.api.mgtv.com/yy/feed?${q}`, { headers: { 'user-agent': MG_APP_UA } });
  let j; try { j = JSON.parse(r.body); } catch (e) { return { ok: false, msg: `pbid=${pbid} 没回话（${r.status}）` }; }
  const feed = (((j || {}).data || {}).feed) || [];
  if (Number(j.code) !== 200 || !feed.length) return { ok: false, msg: `pbid=${pbid} 回 code=${j && j.code} ${j && j.msg}` };
  return { ok: true, items: feed.map(mgFeedItem).filter(Boolean) };
}
async function fetchMG(prevItems) {
  const did = mkUuid();
  const H = { 'user-agent': UA, 'referer': 'https://www.mgtv.com/' };
  const idx = await get(`https://dc.bz.mgtv.com/dynamic/v1/channel/index/${did}/9.0.9/10.0/10000000/space/0/4/5?osType=window&seqId=${did}&device=pc&playList=`,
    { headers: H });
  let ids = [];
  try { ids = (JSON.parse(idx.body).moduleIDS || []).map(x => String(x.moduleEntityId)); } catch (e) { /* 下面按没拿到处理 */ }
  // 12440 写死在第一位试；哪天它换了编号，就顺着首页给的模块表挨个找 vsubscribe。
  const order = ['12440', ...ids.filter(x => x !== '12440')].slice(0, 6);
  let screen = [];
  for (const mid of order) {
    const r = await get(`https://dc.bz.mgtv.com/dynamic/v1/module/infos/${did}/9.0.9/10.0/10000000/space/0/4/5/${mid}?osType=window&seqId=${did}&device=pc&playList=`,
      { headers: H });
    let j; try { j = JSON.parse(r.body); } catch (e) { continue; }
    const dsl = (((j || {}).data || {})['0'] || {}).DSLList;
    if (!Array.isArray(dsl)) continue;
    const m = dsl.find(x => x && x.data && x.data.moduleType === 'vsubscribe');
    if (!m) continue;
    const rows = (m.data.data || []).filter(x => x && x.title && x.aid);
    if (!rows.length) continue;
    screen = rows.map(mgItem);
    break;
  }
  const pb = await Promise.all(MG_PBIDS.map(mgPlaybill));
  const dead = pb.filter(x => !x.ok).map(x => x.msg);
  const feed = pb.filter(x => x.ok).flatMap(x => x.items);
  if (!screen.length && !feed.length) {
    return { ok: false, msg: `首页模块里没有 vsubscribe 那一段；日历那两发也没接上（${dead.join('；')}）` };
  }
  // 屏内次序以模块那一路为准，日历只往后面补新片（同一部以屏内那条为准，日历那条按 aid 去重丢掉）。
  const items = dedupe([...screen, ...feed]);
  const f = await fillMGDetail(items, prevItems);
  return { ok: true, items,
    note: `单子：首页屏内 ${screen.length} 条 + 日历 ${feed.length} 条 → 去重 ${items.length} 条`
        + (dead.length ? `（日历没接上：${dead.join('；')}）` : '')
        + `；这一拍敲了 ${f.asked} 扇门、预约数拿到 ${f.got} 条（集数顺带 ${f.eps} 条，芒果自己没写的记 0 不再敲）、沿用上一轮 ${f.carried} 条` };
}
/* 这一家的预约数和集数在同一个那一页上，所以只有一扇门：敲一次两跳，两个数一起拿。
   十个一开就是 20 个并发请求砸人家 CDN，按 4 个一批走。 */
export function mgQueue(items, max) { return items.filter(x => x.count == null || x.eps == null).slice(0, max); }
/* 日历那一路整条没有预约数 ⇒ 它是「没问过」，不是「没有」：上一轮的 count 必须原样带过来，
   不然接上这一路的下一拍，页面上那 10 个已有的数就全空了（和优酷集数那一条是同一个道理）。 */
export function carryCounts(items, prevItems) {
  const prev = new Map((prevItems || []).filter(x => x.platform === 'mg').map(x => [x.id, x]));
  let kept = 0;
  for (const x of items) {
    if (x.count != null) continue;
    const p = prev.get(x.id);
    if (p && p.count != null) { x.count = p.count; kept++; }
  }
  return kept;
}
async function fillMGDetail(items, prevItems) {
  const carried = carryEps(items, prevItems) + carryCounts(items, prevItems);
  const todo = mgQueue(items, MG_DOOR_MAX);
  let got = 0, eps = 0;
  for (let i = 0; i < todo.length; i += 4) {
    const rs = await Promise.all(todo.slice(i, i + 4).map(x => mgDetail(x.id.slice(3))));
    rs.forEach((r, k) => {
      const x = todo[i + k];
      if (r.count != null) { x.count = r.count; got++; }
      if (r.eps != null) { x.eps = r.eps; if (r.eps > 0) eps++; }
    });
  }
  return { carried, asked: todo.length, got, eps };
}
/* 芒果那个 yy/query/type 口逆到底了，结论是不必再逆：bundle 里那一发的参数是
   {uuid, ticket: HDCN.split('-')[0], aids, appVersion, device, platform, external} —— 全程没有签名，
   但 ticket 来自登录 cookie，匿名就是 {"code":400,"msg":"bad param"}。
   数是白给的，在移动详情页的 SSR 里：m.mgtv.com/b/<aid> 回一个 445 字节的 meta-refresh 壳，
   跟着它给的地址再一跳，页内嵌 JSON 有 "reserveInfo":[{"aid":…,"yyNum":2748419,"yyNumFormat":"274.8万"}]。
   逐条核过 aid 再取，是不想拿到别人家的数。 */
const MG_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';
/* 第二跳那一页同时给两个数：预约数在 reserveInfo、集数在 updateInfo。
   它长这样："updateInfo":"共24集，更新至0集" —— 「更新至 0 集」正是还没开播，「共 N 集」是总集数。
   电影那一条写的是「更新至0期」、整串没有「共」，所以只认「共N集」；
   认不到的那条记 0（＝问过了、芒果没写），《蜘蛛侠：崭新之日》就是这么留成 0 的，不是抓失败。
   ⚠ rbTitle 不是总集数：那是桌面页逐集卡片上的「第1集」「第2集」，一条一集，
      待播那一屏（module 12440 的 vsubscribe）整段都没有它。 */
async function mgDetail(aid) {
  const out = { count: null, eps: null };
  try {
    const hop = await get(`https://m.mgtv.com/b/${aid}`, { headers: { 'user-agent': MG_UA } });
    const m = /url=(https?:\/\/m\.mgtv\.com\/b\/\d+\/\d+\.html)/.exec(hop.body || '');
    if (!m) return out;                     // 连壳都没给跳转 ⇒ 当没敲过，下一拍再试
    const page = await get(m[1], { headers: { 'user-agent': MG_UA } });
    if (!page.body || page.body.length < 2000) return out;   // 真页没拿到，同样当没敲过
    const j = /"reserveInfo":\[(\{[^\]}]*\})/.exec(page.body || '');
    if (j) { const o = JSON.parse(j[1]); if (String(o.aid) === String(aid)) out.count = num(o.yyNum); }
    const u = /"updateInfo":"共(\d+)集/.exec(page.body || '');
    /* 页拿到了、整串没有「共N集」⇒ 芒果自己没写（电影就是这一种：那串写的是「更新至0期」）。
       记 0 当「问过了」，不然这一条每拍都占着一扇门。和腾讯那条空串是同一个处理。 */
    out.eps = u ? Number(u[1]) : 0;
  } catch (e) { return out; }
  return out;
}
function mkUuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}
function mgItem(r) {
  // onlineTime 是 Unix 秒，0 = 未定档；beginTime 是页面印好的一句话（「10-28 12:00」或「敬请期待」）。
  const ts = Number(r.onlineTime) || 0;
  let date = null, time = null;
  if (ts > 0) { const p = bjParts(new Date(ts * 1000)); date = `${p.year}-${p2(p.month)}-${p2(p.day)}`; time = `${p2(p.hour)}:${p2(p.minute)}`; }
  return {
    id: 'mg:' + r.aid, platform: 'mg', title: String(r.title),
    genre: '', cast: '',
    line: String(r.stroy || '').replace(/\s+/g, '').slice(0, 60),
    count: null, hot: '', date, time, dateText: String(r.beginTime || ''), eps: null,
    pic: httpsPic(r.imgHor || r.imgVer || r.img),
    url: String(r.url || `https://www.mgtv.com/b/${r.aid}`),
  };
}

// ---------- 爱奇艺 ----------
// A 路（推荐流口）：匿名、不需要 device_id，覆盖整池（九十多条），但整份一个日期都没有。
// B 路（videolib/data）：唯一带 showDate 的那条，要一个真实 device_id。
//   上一轮判「这个口被风控、不能无人值守」是错的 —— 拦人的不是 device_id，是参数集：
//   把 market_release_date_level 当顶层 query、版本串写死成 17.0.63，15 组猜测全回 261 字节的空数组。
//   照页面自己那一发（version=pcv=17.103.26647 + filter 里带那两个键）拼，risk_level 就是 0，
//   而且 dfp / adExt / os / token 一整串附加参数全删掉照样回 39 条。
// B 路只补字段、不并池子：它那 40 条待播的 album_id 实测 40/40 都在 A 路的 98 条里，一条新片都不带。
async function fetchIQ() {
  const out = [];
  let pages = 0;
  for (let p = 1; p <= 3; p++) {
    const u = 'https://pcw-api.iqiyi.com/search/recommend/list?channel_id=2&mode=11&ret_num=48'
      + `&page_id=${p}&market_release_date_level=%E5%8D%B3%E5%B0%86%E4%B8%8A%E7%BA%BF&is_force_old=0`;
    const r = await get(u, { headers: { 'user-agent': UA, 'referer': 'https://www.iqiyi.com/' } });
    let j; try { j = JSON.parse(r.body); } catch (e) { continue; }
    const list = ((j || {}).data || {}).list;
    if (!Array.isArray(list) || !list.length) break;
    pages++;
    for (const x of list) {
      if (!x.name || !x.albumId) continue;
      out.push({
        id: 'iq:' + x.albumId, platform: 'iq', title: String(x.name),
        genre: (x.categories || []).join(' · '),
        cast: (((x.people || {}).main_charactor) || []).map(a => a && a.name).filter(Boolean).slice(0, 4).join('、'),
        line: String(x.focus || x.description || '').replace(/\s+/g, '').slice(0, 60),
        count: null, hot: '', date: null, time: null, dateText: '', eps: num(x.videoCount),
        // 两条路都给不出专辑页地址（a_<albumId> 那种拼法实测 404），只能退到站内搜索。
        pic: httpsPic(x.imageUrl),
        url: 'https://www.iqiyi.com/search?keyword=' + encodeURIComponent(String(x.name)),
      });
    }
    if (!((j.data || {}).has_next)) break;
  }
  if (!pages) return { ok: false, msg: '爱奇艺 recommend/list 一条都没回' };
  const d = dedupe(out);
  if (d.length < 30) return { ok: false, msg: `爱奇艺只回了 ${d.length} 条，比平时（九十多条）少太多，这轮不用` };
  const got = await fillIQCounts(d);
  const b = await enrichIQ(d);
  const note = `预约人数取到 ${got}/${d.length} 条（一发带 60 个 albumId，不靠 device_id）` + '；' + b.msg;
  return { ok: true, items: d, note, dateRoute: b.dateRoute, spoken: b.spoken };
}

/* C 路：预约人数。全匿名 —— 不带 cookie、不带 dfp、不带 device_id。
   subKeys 收 albumId（也收 tvId，同一个实体两个键回同一个数，两京十五日 1258223 / 它的 tv 1258222），
   所以 A 路那 98 条直接就能问，这一路和 B 路的 device_id 有没有效无关。
   ⚠ subType 必须是 2：给 1 或 3 回的是 count:0，code 照样是 A00000，看着像成功、其实是空的。
   拿到的数和 B 路那句「预约破300万」逐条对得上（来战 301.7万 / 云襄传之将进酒 201.4万 /
   不二之臣 132.4万 / 两京十五日 125.8万），所以两个口互为对照。
   60 个一批：98 个一发实测能过（URL 1785 字节），但池子哪天涨到一百五就该撞长度线，宁可多发一发。 */
async function fillIQCounts(items) {
  const VER = '17.103.26647';
  let got = 0;
  for (let i = 0; i < items.length; i += 60) {
    const batch = items.slice(i, i + 60);
    const keys = batch.map(x => x.id.slice(3)).join(',');
    try {
      const r = await get(
        `https://subscription.iqiyi.com/services/subscribe/countAndState.htm`
        + `?subType=2&agentType=30&version=${VER}&subKeys=${keys}`,
        { headers: { 'user-agent': UA, 'referer': 'https://www.iqiyi.com/' } });
      const j = JSON.parse(r.body);
      if (j.code !== 'A00000' || !j.data) continue;
      for (const x of batch) {
        const n = num((j.data[String(x.id.slice(3))] || {}).count);
        if (n != null) { x.count = n; got++; }
      }
    } catch (e) { /* 这一批拿不到就把 count 留着，交给 hot 那句档位兜 */ }
  }
  return got;
}

/* B 路那一发。拿不到就把 A 路原样交出去 —— 爱奇艺那一格绝不能因为 device_id 失效而整个空掉。
   device_id 只从环境变量进来：不写进正文、不提交、不打日志。
   ⚠ 回话里带一个 dateRoute：它是「这一轮到底问没问过档期」的证据。
   没问过 ≠ 这些片子没档期 —— 下面 build() 拿这个决定要不要把上一轮的日期留着。 */
async function enrichIQ(items) {
  if (!IQ_DID) return { dateRoute: false, spoken: null, msg: 'B 路跳过（没配 device_id），这一轮爱奇艺没有定档日；预约人数走 C 路那条匿名口，不受影响' };
  const VER = '17.103.26647';
  let sid = '', got = 0, pages = 0;
  const byId = new Map();
  for (let p = 1; p <= 4; p++) {
    const q = new URLSearchParams({
      uid: '', passport_id: '', ret_num: '60', pcv: VER, version: VER,
      device_id: IQ_DID, channel_id: '2', page_id: String(p), os: '10.0', vip: '0',
      recent_selected_tag: '即将上线',
      filter: JSON.stringify({ mode: '11', market_release_date_level: '即将上线' }),
      ...(sid ? { session: sid } : {}),
    });
    const r = await get('https://mesh.if.iqiyi.com/portal/lw/videolib/data?' + q,
      { headers: { 'user-agent': UA, 'referer': 'https://www.iqiyi.com/list/tv/' } });
    let j; try { j = JSON.parse(r.body); } catch (e) { continue; }
    if (!Array.isArray(j.data)) continue;
    pages++;
    sid = j.session || sid;                     // 第二页带上上一页回的那个串；实测给不给都一样，那就给
    for (const x of j.data) if (x && x.album_id && iqPending(x)) byId.set(String(x.album_id), x);
    if (!j.has_next) break;
  }
  if (!pages) return { dateRoute: false, spoken: null, msg: 'B 路没回话（device_id 被风控或参数集又变了），这一轮爱奇艺只有 A 路的字段加 C 路的预约人数' };
  let dated = 0, hot = 0;
  const passed = [];
  const today = bjDay(new Date());
  const spoken = new Set();
  for (const x of items) {
    const y = byId.get(x.id.slice(3));
    if (!y) continue;
    spoken.add(x.id);
    got++;
    const raw = iqDate(y);
    const dt = iqDate(y, today);
    if (!dt && raw) passed.push(`${x.title} ${raw}`);   // 上游写着日期，但那一天已经过去了
    if (dt) { x.date = dt; x.dateText = dt; dated++; }
    const ht = iqTag(y, '1010');
    if (ht && !x.hot) { x.hot = ht; hot++; }
    if (!x.cast) x.cast = (y.contributor || []).map(c => c && c.name).filter(Boolean).slice(0, 4).join('、');
    if (!x.genre) x.genre = String(y.tag || '').split(';').filter(Boolean).slice(0, 2).join(' · ');
    if (!x.line) x.line = String(y.desc || '').replace(/\s+/g, '').slice(0, 60);
    if (!x.pic) x.pic = httpsPic(y.image_url_1x || y.image_cover);
  }
  return { dateRoute: true, spoken,
    msg: `B 路对上 ${got}/${items.length} 条，其中带真档期 ${dated}、带预约档位 ${hot}`
      + (passed.length ? `；另有 ${passed.length} 条写的开播日已经过去了（${passed.join('、')}），没当档期收` : '') };
}
// 「即将上线」这个标在 taglines 里，不在 album_name（40 条里只有 9 条填了 album_name）。
const iqPending = x => (x.taglines || []).some(t => String(t.subType) === '2009');
const iqTag = (x, st) => ((x.taglines || []).find(t => String(t.subType) === st) || {}).text || '';
/* showDate 的占位是 1 月 1 日 —— 2026-1-1、2025-1-1、2027-1-1 都见过，
   没排上档期的片子填的就是这一格，不能当真档期用（当真就会印出「1 月 1 日开播」这种假定档）。 */
export function iqDate(x, today) {
  const d = (x || {}).date;
  if (!d || !/^\d{4}$/.test(String(d.year))) return null;
  const m = Number(d.month), day = Number(d.day);
  if (!(m >= 1 && m <= 12 && day >= 1 && day <= 31)) return null;
  if (m === 1 && day === 1) return null;
  const s = `${d.year}-${p2(m)}-${p2(day)}`;
  /* ⚠ 已经过去的日期不算档期。10-26 他抓到的那一条就是这一类：《夺金战》在爱奇艺
     那份「即将上线」库里挂着 subType 2009 的标（文案还是「下周一上线」），日期却写着 2026-09-26 ——
     它一个月前就开播了，是那一屏没清干净，不是待播。收进来就是「已排档期」里冒出一个过期的格子。
     传 today 才挡；不传留给单测看解析本身。 */
  if (today && s < today) return null;
  return s;
}

// ---------- 公共 ----------
function num(v) { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; }
/* 四家给的海报地址有一半是 http://，Pages 是 https，浏览器会当成混合内容直接拦掉。
   阿里云/腾讯视频这些图床都认 https，所以入库前统一换成 https，不给就留着。 */
const httpsPic = s => String(s || '').replace(/^http:/, 'https:');
function dedupe(arr) {
  const m = new Map();
  for (const x of arr) if (!m.has(x.id)) m.set(x.id, x);
  return [...m.values()];
}

/* 和上一轮比，出四类事：新定档（原来没日期、现在有）、改档（日期变了）、进池、出池。
   只比「这一轮真的取到了」的那几家：某家取数失败时它的旧条目原样留着，
   不然一次网络抖动就写成「今天撤了 36 部」。 */
export function diff(prev, items, livePlatforms, known) {
  const now = new Map(items.map(x => [x.id, x]));
  const before = new Map((prev || []).filter(x => now.has(x.id) || livePlatforms.has(x.platform)).map(x => [x.id, x]));
  const scheduled = [], rescheduled = [], newIn = [], out = [];
  for (const x of items) {
    const b = before.get(x.id);
    if (!b) { newIn.push(brief(x)); continue; }
    /* 「新定档」认的是这个日期我们头一回知道，不是「上一拍的 items 里没有」——
       known 是全部事件行攒出来的（见 build() 那一段）。改档那一支不查它：日期动了就是新闻。 */
    if (!b.date && x.date) {
      if (!(known && (known.get(x.id) || new Set()).has(x.date)))
        scheduled.push({ ...brief(x), date: x.date, time: x.time });
    }
    else if (b.date && x.date && b.date !== x.date)
      rescheduled.push({ ...brief(x), from: b.date, to: x.date });
  }
  for (const b of before.values()) if (!now.has(b.id)) out.push(brief(b));
  const by = a => a.sort((x, y) => (x.platform + x.title).localeCompare(y.platform + y.title, 'zh'));
  return { scheduled: by(scheduled), rescheduled: by(rescheduled), newIn: by(newIn), out: by(out) };
}
/* 事件行为什么带 pos：屏内序号每拍会被下一拍覆盖，「在前的快要定档」这句话要回测的是
   定档/进池**那一刻**它排第几 —— 不跟着事件存下来，攒多少天都只剩「今天这一屏」。
   对照组不用另存：days[].counts 就是同一拍的池子条数，pos 若与定档无关就该是均匀分布。
   撤下那一行的 pos 是它最后一次已知的序号（那一家当天没取到时，它是上一拍的）。 */
const brief = x => ({
  id: x.id, platform: x.platform, title: x.title, date: x.date || null,
  pos: Number.isInteger(x.pos) && x.pos > 0 ? x.pos : null,
});

/* 一天里的多拍合成一格：同一条只记第一次发生，时刻推进到最新。
   否则「今日新定档」会把同一部片在四拍里印四遍。 */
export function mergeDay(cur, fresh, at, counts) {
  if (!cur) return { day: at.slice(0, 10), firstAt: at, at, counts, ...fresh };
  const keep = (a, b) => { const m = new Map(a.map(x => [x.key || x.id, x]));
    for (const x of b) if (!m.has(x.key || x.id)) m.set(x.key || x.id, x); return [...m.values()]; };
  return { ...cur, at, counts,
    scheduled: keep(cur.scheduled, fresh.scheduled),
    rescheduled: keep(cur.rescheduled, fresh.rescheduled),
    newIn: keep(cur.newIn, fresh.newIn),
    out: keep(cur.out, fresh.out) };
}

export async function collectAll(prevItems) {
  const one = async (k, fn) => { try { return [k, await fn()]; } catch (e) { return [k, { ok: false, msg: k + ' 取数异常：' + e.message }]; } };
  const rs = await Promise.all([one('qq', () => fetchQQ(prevItems)), one('yk', () => fetchYK(prevItems)), one('mg', () => fetchMG(prevItems)), one('iq', fetchIQ)]);
  return Object.fromEntries(rs);
}

export function build(prevDoc, results, at) {
  const prevItems = Array.isArray(prevDoc && prevDoc.items) ? prevDoc.items : [];
  const live = new Map(Object.entries(results).filter(([, r]) => r.ok).map(([k, r]) => [k, r.items]));
  const warnings = Object.entries(results).filter(([, r]) => !r.ok).map(([k, r]) => ({ platform: k, msg: r.msg }));
  /* 站内序号 pos：上游那一屏从上到下排第几（1 起，平台内）。
     它是页面给的定序、不是每次摇出来的（接口名里那个 scms_shake 只是模块名）：
     腾讯 coming_soon 那 36 条连打三次顺序逐条一致。
     ⚠ 但「一致」只在分钟级成立 —— 19:34 和 21:56 两相比，腾讯 36 条动了 13 条、爱奇艺 94 条动了 56 条，
     优酷和芒果那两屏一条没动。所以 pos 是「这一拍那一屏」的快照，不是这部片子的固定编号。
     ⚠ 10-26 起优酷换走片单那一路（144 条），它那一份 pos 是「片单里排第几」，
     不再是首页那一横排的第几张 —— 那一屏只有 20 张，20 之后的序号在首页上根本不存在。
     ⚠ 同一天芒果并上了新片日历（10 条 → 51 条）：前 10 位仍是首页那一屏从上到下，
     11 之后是日历给的次序（去重时把 screen 排在 feed 前面就是为了保住这一点）。
     ⚠ 同一天腾讯并上了筛选页那一路（100 条 → 126 条）：前 100 位仍是 coming_soon 那一屏，
     101 之后是筛选页给的次序 —— 那一路自己那个「最热」不能拿来排序（拿它的 124 条对着卡片池的
     预约整数数过，52 处逆序），所以它只能垫在卡片那一路后面，不能替它。
     回测「在前的快要定档」时，跨家的 pos 不能直接比大小，只能各家用各自那一路的次序。
     写在这里不写在 fetch 里：四家各有各的返回路径，漏一家就少一家，而这一处保证不漏；
     ⚠ 但必须在下面那个 sort 之前 —— 落盘前按预约数重排之后，原来的屏内次序就已经没了。
     取数失败那一家走的是 kept 那条路，它的旧序号原样留着，不会被这一轮的空结果打乱。
     光存 items 里这一份会被下一拍覆盖，所以事件行也各带一份，见 brief()。 */
  for (const its of live.values()) its.forEach((x, i) => { x.pos = i + 1; });
  /* 爱奇艺的开播日期是单独那一路（B 路）给的，整池条目却是另一路给的 —— 两路会各活各的。
     10-26 08:30 那一拍就是撞在这个上面：94 条照常回来、预约数照常带上，只有档期那一路没说话，
     于是「已排档期」从 2 部掉到 1 部，看的人以为《谜林》撤档了，其实是取数的手抖了一下。
     规则按「这一轮有没有问到这一条」来分，不按整家分：
       · 档期那一路整条没回话，或者回话里没点到这一条 ⇒ 上一轮已知的日期原样留着（没问过 ≠ 没有）；
       · 档期那一路点到了这一条、却没给日期       ⇒ 那才是真没排上档期，照实清空。
     代价：片方悄悄把已公布的档期撤掉、而那一轮又恰好没回话时，这里会继续挂着旧日期 ——
     但那种情况本来就没有可信的信号，宁可留着并记一行警告，也不要让它凭空消失。 */
  const iqR = results.iq;
  if (iqR && iqR.ok && live.has('iq')) {
    const spoken = iqR.spoken instanceof Set ? iqR.spoken : null;
    const prevIQ = new Map(prevItems.filter(x => x.platform === 'iq').map(x => [x.id, x]));
    /* 上一轮的 items 自己也可能已经被同一只手擦过一遍 —— 10-26 08:30 那一拍就是这个状态。
       那种时候唯一还留着这个日期的地方是事件行：days[] 里那条「新定档」自带 date。
       ⚠ 只在整路没回话时才翻它：回话点过名、却没给日期，那是真撤了档，翻出来就是假档期。
       残余的代价跟着变大一点：一条真撤掉的档期，如果在撤之后遇上一次没回话的拍，会被这行顶回来 ——
       diff 里没有「档期消失」这一类事件，所以现在还没有能把它认出来的凭据。 */
    const archive = new Map();
    if (!spoken) {
      for (const dy of (Array.isArray(prevDoc && prevDoc.days) ? prevDoc.days : []))
        for (const k of ['scheduled', 'rescheduled'])
          for (const r of (dy[k] || [])) if (r && r.date) archive.set(r.id, r);
    }
    let carried = 0;
    for (const x of live.get('iq')) {
      if (x.date || (spoken && spoken.has(x.id))) continue;
      const p = prevIQ.get(x.id);
      const from = p && p.date ? p : archive.get(x.id);
      if (from && from.date) {
        x.date = from.date; x.time = from.time || null; x.dateText = from.dateText || from.date;
        if (!x.line && from.line) x.line = from.line;
        carried++;
      }
    }
    if (carried) warnings.push({ platform: 'iq', field: 'date',
      msg: `爱奇艺这一轮没问到开播日期，${carried} 部的档期沿用上一轮那一份` });
  }
  const kept = prevItems.filter(x => !live.has(x.platform));
  // 取到的覆盖同平台的旧条目，没取到的把旧条目留着（并记一条警告）。
  const items = [...kept, ...[...live.values()].flat()];
  /* 站内排序：先按预约人数从多到少，人数一样的把已经排到日期的顶到最前，
     档期近的又比档期远的靠前。原来那一版是 date 降序，接上爱奇艺 B 路之后会让
     「唯一填了档期的那一部」沉到 98 行最底下 —— 页面页脚说的「已定档的先出现」就成假话了。
     ⚠ 这个 sort 不改 pos：pos 是屏内次序的证据，页面上不重排它，重排了它就没意义了。 */
  const sorted = items.slice().sort((a, b) => a.platform.localeCompare(b.platform)
    || (b.count || 0) - (a.count || 0)
    || (b.date ? 1 : 0) - (a.date ? 1 : 0)
    || String(a.date || '').localeCompare(String(b.date || '')));
  const counts = {};
  for (const k of Object.keys(PLATFORMS)) counts[k] = sorted.filter(x => x.platform === k).length;
  /* 每一家自己的数字是几点的。取到了就是这一拍，没取到就沿用它上一次取到的那一拍 ——
     页面拿这个和全局 at 比，不一样才多印一行「这批 · 时刻」。
     这是报时刻不是报判断：不用脚本替看的人下「这家坏了」的结论。 */
  const prevAt = (prevDoc && prevDoc.platformAt) || {};
  const platformAt = {};
  for (const k of Object.keys(PLATFORMS)) platformAt[k] = live.has(k) ? at : (prevAt[k] || at);
  const days = Array.isArray(prevDoc && prevDoc.days) ? prevDoc.days.slice() : [];
  const baseline = !prevItems.length;
  if (!baseline) {
    /* 已经记过的档期不再算一次「新定档」。diff 原来只跟上一拍的 items 比 ——
       10-26 就是栽在这里：B 路断了一拍，那一拍把《谜林》10-27 从 items 里擦掉了（10-25 那格事件行还记着它），
       接上之后同一件事被当成今天的新事又记了一遍。看的人翻到 10-25、10-26 两格都是它，
       会以为这一天又定了一次档。所以这里拿全部事件行当凭据：同一个片子的同一个日期，记过就不再记。
       ⚠ 代价：一部片子撤档之后又定回同一个日期，这一版认不出来 —— 撤档本来就没有事件类型，
       那条要等给 diff 补「档期消失」那一支一起解决，我没顺手加。 */
    const known = new Map();
    for (const dy of days) for (const k of ['scheduled', 'rescheduled']) for (const r of (dy[k] || [])) {
      const s = (known.get(r.id) || new Set()).add(r.date || r.to);
      known.set(r.id, s);
    }
    const d = diff(prevItems, sorted, new Set(live.keys()), known);
    const today = days.find(x => x.day === at.slice(0, 10));
    const rest = days.filter(x => x.day !== at.slice(0, 10));
    const merged = mergeDay(today, d, at, counts);
    /* 今天这一格里，日期已经过去的「定档/改档」不算事 —— 那是挡过期日期那条规矩加上之前
       写进去的（10-26 中午那一拍手动重跑记下的《夺金战》2026-09-26）。
       ⚠ 只清今天这一格：前几天那一格是历史，日期走过去是正常的事，不许动。 */
    const day0 = at.slice(0, 10);
    for (const k of ['scheduled', 'rescheduled'])
      merged[k] = (merged[k] || []).filter(r => !((r.date || r.to) && (r.date || r.to) < day0));
    days.length = 0;
    days.push(...rest, merged);
  }
  days.sort((a, b) => a.day.localeCompare(b.day));
  if (days.length > KEEP) days.splice(0, days.length - KEEP);
  const doc = {
    schema: 1,
    at,
    baseline,
    counts,
    platformAt,
    platforms: PLATFORMS,
    warnings,
    days,
    items: sorted,
  };
  return doc;
}

async function main() {
  const at = bjStamp(new Date());
  let prevDoc = null;
  if (fs.existsSync(OUT)) { try { prevDoc = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { prevDoc = null; } }
  const results = await collectAll(prevDoc && prevDoc.items);
  const doc = build(prevDoc, results, at);
  for (const k of Object.keys(PLATFORMS)) {
    const r = results[k];
    console.log(`${PLATFORMS[k].name}：${r.ok ? r.items.length + ' 条' : '取数失败 —— ' + r.msg}`);
    if (r.ok) {
      const withDate = r.items.filter(x => x.date).length;
      const withCount = r.items.filter(x => x.count != null).length;
      const withEps = r.items.filter(x => x.eps > 0).length;
      console.log(`   带定档日 ${withDate}/${r.items.length}   带预约数 ${withCount}/${r.items.length}`
        + `   带集数 ${withEps}/${r.items.length}`
        + (r.note ? '   ' + r.note : ''));
      r.items.slice(0, 3).forEach(x => console.log('   •', [x.title, x.dateText || '—', x.count == null ? '—' : x.count, x.genre || '—'].join(' | ')));
    }
  }
  const last = doc.days[doc.days.length - 1];
  if (last && !doc.baseline) console.log(`${last.day} 累计：新定档 ${last.scheduled.length} / 改档 ${last.rescheduled.length} / 进池 ${last.newIn.length} / 出池 ${last.out.length}`);
  else console.log('第一份档案：没有上一轮可比，diff 留空属正常');
  const dead = doc.warnings.filter(w => !w.field);
  if (dead.length) console.log('⚠ 这一轮有家没取到：' + dead.map(w => PLATFORMS[w.platform].name).join('、'));
  doc.warnings.filter(w => w.field).forEach(w => console.log('⚠ ' + w.msg));
  if (PROBE) { console.log('PROBE：不写文件'); return; }
  /* 每一轮都写：at 这个字段本身就是页面顶部「最后一次采集」那一行的全部内容，
     它不动，看的人就没法区分「今天一条新闻都没有」和「链路断了」。
     待播池一天两拍（早 8 晚 8）：固定 28 个请求/拍、56 个/天，加上逐条那笔浮动最多 76 个/拍。 */
  fs.writeFileSync(OUT, JSON.stringify(doc) + '\n', 'utf8');
  console.log(`写了 ${OUT}（${doc.items.length} 条 · ${doc.days.length} 天 diff）`);
}

// 校验脚本要 import 这里面的纯函数，所以「直接跑」得认得出自己是命令行那一发。
if (process.argv[1] && /fetch_paibo\.mjs$/.test(process.argv[1].replace(/\\/g, '/'))) {
  main().catch(e => { console.error('跑了但炸了：', e.message); process.exit(1); });
}
