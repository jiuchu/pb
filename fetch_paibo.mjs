// 四站「即将上线」待播池采集 + 每日新定档 diff。
//
// 产出 paibo.json，一页看板读它。四个口全是匿名的：不要账号、不要浏览器、不落任何凭据。
// 只有优酷那一发要按 mtop 的规矩现签一次（头一发换一枚临时票，签完就丢），其余连签名都没有。
// 一轮 120 个固定请求（腾讯 4 + 腾讯即将上线筛选页 4 + 优酷 9 + 芒果首页 2 + 芒果新片日历 2
//   + 爱奇艺 A 路 3 + 爱奇艺预约数 2 + 爱奇艺档期 92）。
// ⚠ 一天几轮这件事要数两处，不是一处：Worker 定点四拍（北京 08:30 / 12:30 / 16:30 / 20:30），
//   加工作流自己那个备份闹钟两拍 —— 它没有按事件名设门禁，迟到那一发照样采、照样提交
//   （11-02 数过档案的提交时刻：北京 14:12 / 14:43 / 14:44 那几发就是它写的）。
//   ⇒ 一天 6 轮 = 720 个固定请求/天。抬到四拍是 11-02 他要的，备份那两拍不是新加的、一直在跑。
// ⚠ 大头是爱奇艺档期那一路：它按片名搜、没有批量口，一条一个请求 ⇒ 92 跟着池子大小走，
//   池子涨到一百二它就跟着涨。按 4 个一批发，实测整池 16 秒跑完、连打 12 发零异常、
//   四并发连敲 92 发零失败。一天 6 轮 ⇒ 那一个口一天 552 发，是这一版新担的账；
//   真被挡了不会写坏档案（对上的不足 30 条就整轮当没问到，旧档期原样留着）。
//   省它的办法只有一个：找到 App「新片预告」那一屏的列表口（一发给一整月的档期），
//   11-02 还没找到，网页端只有逐条搜索这一种形状。
// ⚠ 另有一笔浮动的：三家有逐条补的数 —— 优酷的集数+主演在每部片子自己的 www show 页（一条一个请求），
//   腾讯的集数+主演在自己的详情页（一条一个请求），
//   芒果的预约数、集数、大类、主演在自己的移动端页（一条两个请求：445 字节的壳 → 真页）。
//   ⚠ 「大类」是电视剧/电影/动漫少儿那一档（剔电影用的），不是页面上片名底下那一串类型；
//     那一串在日历那一路的 info.tag 里，不敲这扇门（见 mergeMgGenre）。
//   每家每拍最多补 12 条 ⇒ 浮动上限 12 + 12 + 12×2 = 48 个，一轮最多 120+48=168 个、一天最多 1008 个（6 轮）。
//   ⚠ 优酷那一栏还有一个尾部：www 那张页被优酷自己的反爬掐掉时（回 1,529 字节的 punish 跳转，不是没这页）
//     要多补一发 m 站才拿得到集数 ⇒ 那一拍最多 12×2 个，全池被掐的天花板是 60 个/拍、一天 1080 个。
//     本机实测这一发是被我自己敲出来的（几分钟 40 多发），Actions 每拍 12 发没这个密度。
//   池子铺一遍：腾讯 138 条约 12 拍、优酷 144 条约 12 拍、芒果 51 条约 5 拍，之后每拍只碰新进池的那几条。
//   ⚠ 芒果这一版多排队列一项（大类）：10-26 上传后的头几拍它要把这 51 条重新走一遍门，约 5 拍认完，
//     认一条少一条（认出的大类存在档案里，下一拍接回来用），认完之后就只剩新进池的那几条排队。
//     这一拍之前页面上还会看见电影和动漫，不是我漏了 —— 门数没变，只是排在后面的还没敲到。
//   ⚠ 腾讯那 12 扇门不是从第 1 条开始铺：筛选页独有的那 26 条排在最前（填率 21/26，卡片那一屏只有 8/100），
//     所以前三拍先把它们扫完、页面上靠后那一条也能早点有集数；整池仍旧 11 拍（门数没变），
//     只是卡片那一屏从第九拍推到第十一拍。
//   爱奇艺的集数和预约数本来就在批量路里，一个逐条请求都不花（档期那一路除外，见上面）。
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
//         → 档期也在这一发里（11-03 接上）：定档了 onlineDesc 写「11月5日上线」，开播当天改成「今天上线」，
//           没定档写「即将上线」，整池 144 条一次读完，一个请求不多花 —— 优酷没有爱奇艺那种单独的档期口
//         退路是首页 SSR（www.youku.com/ku/webtv）那一屏，只有 20 条；片单不回了才走它（subtitle 同一句话）
//         集数和主演都不在这一路里，在每部片子自己的详情页 GET www.youku.com/show/id_<showid>.html：
//         同一页里 episodeTotal 给集数、person[] 里 type 为 performer 的那些人给主演，一条一个请求。
//         ⚠ 11-02 之前走的是 m.youku.com/alipay_video 那张 6 万字的页面（同一个 episodeTotal，省字节），
//           但那张页面上**没有主演名单**（主演只在 showSubtitle 那句宣传语里出现）⇒ 门挪到 www 这一张
//           （40 万字上下），请求数一个不多花；www 被优酷自己的反爬掐掉时退回 m 站那一发只拿集数。
//   芒果  两条路并一张单子：
//         ① GET dc.bz.mgtv.com/dynamic/v1/channel/index → module/infos：首页模块 12440 内嵌的 vsubscribe DSL，
//            10 条，带 onlineTime（Unix 秒）—— 屏内次序以这一路为准
//         ② GET playbill.api.mgtv.com/yy/feed?yyId=8|9（新片日历）：一发一整张、不翻页，
//            pbid=8 给 32 条、pbid=9 给 51 条（11-03 实测；两张互有交叉，①那 10 条全在 9 里）；
//            ⚠ 这一路的 URL 参数里那串设备标识（did/mac/oaid/seqId）随手编的就是同一份数据，不需要真机号
//            ⚠ 这一路结构上没有预约数，也没有集数（duration 不是集数，实测证伪过）
//            ✅ 它给类型：info.tag 那一串（11-03 接进池子，见 mergeMgGenre）—— 屏内那一路唯一缺的就是这一格
//         四个数都在逐条那一扇门里：m.mgtv.com/b/<aid> 两跳到 SSR 的 reserveInfo[0].yyNum（精确预约数），
//         同一页里还有 "updateInfo":"共24集，更新至0集"，页头 <title> 末段是芒果自己标的大类，
//         页内那段 videoinfo 里有 "演员：檀健次 \u002F 卢昱晓 \u002F …" ⇒ 一次敲门拿四个数，一个请求不多花
//         ⚠ 演员那一格的**键号会错位**（上星剧多插一条 "电视台："，演员就从键 3 挪到键 4），
//           所以只按「演员：」这个标签认，不许按键号取（11-02 抽 16 条：按键号取 14/16，按标签取 16/16）
//         ⚠ 这一家只收「电视剧」：电影、动漫少儿整条搬出池子（他 10-26 点的），认不准的照旧留着
//   爱奇艺 A 路 GET pcw-api.iqiyi.com/search/recommend/list?...market_release_date_level=即将上线
//         → 3 页整池（这一家自己会抖：本机 98、线上 94），只有片名/主演/集数/简介，一个日期字段都没有
//         ⚠ 类型（categories）给不齐：11-03 整池 99 条里 56 条是空数组，空的那些靠 D 路补
//   爱奇艺 C 路 GET subscription.iqiyi.com/services/subscribe/countAndState.htm
//         → 预约人数精确整数，subKeys 一次带 60 个 albumId
//   爱奇艺 D 路 GET mesh.if.iqiyi.com/portal/lw/search/homePageV3?key=<片名>
//         → 档期：releaseTime.value 给 '2026-11-05'（排上了）或 '2026'（没排上的占位，只给年份）
//           一条一个请求、按 qipuId 和 A 路的 albumId 硬对上（11-02 整池 92/92、当场 5 条带档期）
//         → 同一份回话还带类型（tags，11-03 起补 A 路空着的那 56 条）和真正的专辑页地址（pageUrl），
//           一个请求不多花
//           ⚠ 上一代那一发是 B 路 videolib/data（要 device_id），10-27 起 0 次回话、11-02 摘干净了，
//             细节写在下面 iqDates 那一段的考古注释里
//
// ⚠ 三条路的 albumId 是同一套：D 路回话里的 qipuId 就是 A 路的 albumId，所以它只补档期这一栏，
//   不并池子 —— 池子永远以 A 路那一屏为准（B 路当年也是 40/40 全在 A 路里，一条新片都不带）。
//
// ⚠ 日期四家都给得出，但没有一家是「排期表」：腾讯和芒果把定档那一刻写进字段（待播的绝大多数仍是
//   空串/0），爱奇艺只在片方真排上档期时才把 releaseTime 从年份填成完整日期，优酷写的是片单里那句人话
//   （onlineDesc：定档了写「11月5日上线」，开播当天写「今天上线」，没定档写「即将上线」）。
//   ⚠ 这两行 11-03 之前写的是「优酷那两条路一个日期字段都没有」—— 那是 10-25 那天整池确实没一条定档时
//     下的结论，把「当时池里没有」读成了「这一家不给」。《谷雨》的档期一挂上，片单那一格就跟着改了口，
//     而片单本来每拍就整池拉 ⇒ 接上它一个请求不多花（11-03 实测 144 条里 1 条带上线日）。
//   11-02 这一拍爱奇艺 92 条待播里 5 条有档期、优酷 144 条里 1 条 —— 这是常态不是故障。
//
// ⚠ 预约数四家都给得出精确整数（腾讯 order_person_count / 优酷 reserve.count / 芒果 yyNum /
//   爱奇艺 countAndState）。10-25 之前这份脚本按「爱奇艺只给『预约破300万』这种档位」写的，
//   那个口径是错的：档位文字是另一格字段，独立的一个口一直存在，只是没找着。
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
// ⚠ 主演这一栏四家都给得出，但来源和「脏法」各家不同（11-02 逐条量过，见下面四行）：
//   爱奇艺 = A 路的 people.main_charactor（结构化，白拿）；
//   芒果 = 预约数那一扇门的同一页里，"演员：…" 那一格（按标签取，键号会因「电视台」错位）；
//   优酷 = www show 页 person[] 里 type 为 performer 的那些（跟集数同一扇门、同一个请求）；
//   腾讯 = 列表那一格当值、逐条详情页的 star_list 当核对（跟着集数那一扇门一起拿，一个额外请求不花）。
//   ⚠ 上一版这一节写的是「主演只有两家给得起、优酷芒果那两个口压根没有」—— 那是错的：
//     真实情况是我当时读的那两格没有，芒果的在已经下载的那一页里、优酷的在已经存进档案的那个地址上。
//   ⚠ 优酷不能用那张页里的 "_personNameArr"：它不是演员名单，是「这片子的头几号人物」，
//     导演和原著作者会混进来（恋人 =「赵露思、彭冠英、邓科」，邓科是导演；
//     少年歌行2之南明离火 =「尹涛、周木楠、周木楠」，一个是导演、两个是原著+编剧，那页一个演员都没填）。
//     performer 这一档过滤掉的就是他们 ⇒ 只信带类型的 person[]，宁可空着也不印导演。
//   ⚠ 11-02 优酷/芒果这两栏各自抽 16 条：芒果 16/16 有演员、优酷 16/16 有 performer 名单。
//   腾讯那两笔账分开核过：① 上一版档案里 119 条有主演，**只有 3 条填的是宣传语**
//     （赢风「情利交刃传奇开幕」、此刻的生活「别墅区人心拉扯」、多喜一家人「平凡人家大戏启幕」）
//     —— 他截图抓到的正是前两条；② 抽 24 部逐条敲详情页当标准答案，卡片路 topic_label 对 13/15、
//     筛选页 sub_title 对 20/23，没对上的那几条是「那一格本来空着」和「列表把导演排掉了」，一条宣传语都不是。
//     ⇒ 列表那一格是主演本尊、但不是干净的：错的那 3 条要能被挡掉，才配继续印在「主演」下面。
//   ⚠ 反过来 star_list 也不干净：它是主创名单，导演和编剧混在里面排前头
//     （大唐辟珠记第一位是导演费振翔、35而已 那两个是导演+编剧、来战第四位是原著作者九鹭非香）。
//     所以两个来源都不许单独信：列表那格的第一名字能在 star_list 里找到 ⇒ 留列表那格（它反倒排掉了导演）；
//     找不到 ⇒ 那格填的不是人 ⇒ 换成 star_list 前四个（赢风就是这么变成「万鹏、张弛、迟蓬、黄景瑜」的，
//     和他 App 截图那一排一字不差）。两边都拿不出人 ⇒ 空着。
//
// 历史为什么必须自己攒：四个口都只回「当前」这一屏，没有更深的历史接口。
// 哪天定档、哪天进池、哪天被撤，只有这个文件里留着。所以它是「读旧-追加-写新」，
// 和 billboard.json 一样，谁也不能把别人攒的那几格覆盖掉。
//
// 环境变量：
//   PAIBO_OUT      产出路径，默认 paibo.json
//   PAIBO_KEEP     diff 最多留多少个自然日，默认 60
//   PAIBO_PROBE    1 = 取数、打印、不写文件（用来验 Actions 的机房 IP 能不能取到数）
//   （11-02 起没有第四个：档期那一路换到匿名的搜索口，PAIBO_IQY_DID 和仓库那个 Secret 一起退役了。）

import fs from 'node:fs';
import crypto from 'node:crypto';

const md5 = s => crypto.createHash('md5').update(s).digest('hex');

const OUT = process.env.PAIBO_OUT || 'paibo.json';
const KEEP = Number(process.env.PAIBO_KEEP) || 60;
const PROBE = process.env.PAIBO_PROBE === '1';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const MS = 25000;

export const PLATFORMS = {
  qq: { name: '腾讯视频', hasDate: true, hasCount: true },
  yk: { name: '优酷', hasDate: true, hasCount: true },
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
const sleep = ms => new Promise(res => setTimeout(res, ms));

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
/* ── 腾讯的类型其实有两格（11-02 他指着「年代谍战」问：页面上四个字，我们怎么只印「谍战」）────
   main_genre 是它自己那套**大类**（谍战 / 爱情 / 武侠），而网页片名底下那一排印的是
   chnlist_search_label 里 **category=80** 那一串**复合类型**（千里江山图=年代谍战、
   花间酒人间月=偶像爱情+古装爱情）。旧版只读了大类那一格，所以四家里只有腾讯这一栏永远是单值
   （优酷 87/144、芒果 38/47、爱奇艺 27/92 都带「 · 」，腾讯 0/138）。
   ⚠ 同一格里还有 category=90（剧情元素：相爱相杀、时间轮回、头脑博弈）和 100（厂牌：港剧、X剧场）。
     那是另外两套口径，**不并进类型串** —— 混成一串等于我造一个腾讯自己没有的「类型」，
     看的人分不清哪枚是分类、哪枚是卖点。
   136 条实测：111 条有 80 那一档，其中 61 条不止一枚（最多四枚）；剩下 25 条回落到大类。
   两格并成一串（包含去重 + 上限 3 枚）走下面 genreText 那一把公共的尺子。
   ⚠ 这一格是 JSON **字符串**（要 parse，和 qqTier 同一个字段），且卡片那一路（coming_soon）没有它 ——
     所以两条路要在 mergeQq 里比一比谁给得多，见下面那一段。 */
const GENRE_CAP = 3;
/* 一串类型怎么落定：先按「包含」去重（大类「谍战」被复合标签「年代谍战」整个包住 ⇒ 只留长的，
   不然页面上印的是「谍战 · 年代谍战」，同一件事说两遍），再削到 3 枚。
   ⚠ 上限 3 枚不是数据给到 3 就停：大屏那一档 .sb 是 nowrap + 省略号，第四枚会把「主演」挤出可见区。
   11-03 起腾讯、爱奇艺两栏共用这一条规矩（原来只有腾讯走它）。 */
export function genreText(head, extra, cap = GENRE_CAP) {
  const uniq = [];
  for (const s of [head].concat(extra || [])) { const t = String(s == null ? '' : s).trim(); if (t && uniq.indexOf(t) < 0) uniq.push(t); }
  return uniq.filter(s => !uniq.some(o => o !== s && o.indexOf(s) >= 0)).slice(0, cap).join(' · ');
}
/* 「主演」这一栏只认人名：平台自己在那一格写「未知」的，等于没标 ⇒ 整栏不写（他 11-03 点的：
   没标就不写，不要印「未知」）。线上此刻 8 条是这一种 —— 芒果 7 条（风起玲珑骨 第一季、无常录、落花有意、
   翡色、成凤、同行相轻、永不掉队，那一页 "演员：未知"）、爱奇艺 1 条（平原客，A 路 main_charactor 里
   那个 name 就是「未知」）。只削这一个占位词：别的（待定/暂无）我没在线上见过，不替平台猜。
   ⚠ 它不改 castOk：门敲开了、页上写的是占位，那就是「问过了」，下一拍不许再为它开一扇门。 */
export function noUnknown(s) {
  return String(s || '').split('、').map(t => t.trim()).filter(t => t && t !== '未知').join('、');
}
export function qqLabels(p) {
  try {
    const out = [];
    for (const l of JSON.parse((p || {}).chnlist_search_label || '[]')) {
      if (!l || l.category !== 80 || !l.label) continue;
      const s = String(l.label).trim();
      if (s && out.indexOf(s) < 0) out.push(s);
    }
    return out;
  } catch (e) { return []; }                       // 那一格不是合法 JSON ⇒ 回落到大类，不算没采到
}
// ⚠ 这一路 sub_title 当主演取、second_title 当宣传语取（和卡片那一路正好反着：卡片路 sub_title 是宣传语）。
//   同一份字段名在两条路上意思对调，接错的那一版「主演」那一栏会整列变成一句广告词、且没有一项会红。
//   ⚠ 取回来同样不算是认过的（castOk=false）：这一路 124 条里 sub_title 也掺宣传语（赢风那一行就是），
//     要等逐条那一扇门和详情页 star_list 对过才落字。见上面 topic_label 那一段的两笔账。
// ⚠ 124 条实测 type/item_type 全是 '2'（剧集），因为这张列表就是电视剧频道的；同一个字段名在
//   nav_card 那八张卡上是「频道 id」。所以别顺手把 filter_params 改成别的频道 —— 改了就混进电影，
//   而这一路没有类目字段可以拦（真到那一步要按 type 拦，并在注记里报拦掉几条）。
export function qqListItem(p) {
  if (!p || !p.title || !p.cid) return null;
  return {
    id: 'qq:' + p.cid, platform: 'qq', title: String(p.title),
    genre: genreText(p.main_genre, qqLabels(p)),
    cast: qqCastSp(p.sub_title), castOk: false, line: String(p.second_title || ''), count: null, hot: qqTier(p),
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
   ⚠ 传进来的数组的长度和次序不许动（外面还指着它算卡片条数）；条目对象照旧原地填 ——
     集数、主演、类型都是这么填的。
   类型那一格两条路各给一半：卡片路的 topic_label 只有大类一段，筛选页还带着复合标签（年代谍战），
   所以重叠的那 98 条要拿筛选页那一版 —— 其余字段一律不动，别把精确预约数换没。 */
export function mergeQq(cardItems, listItems) {
  const out = cardItems.slice();
  const has = new Set(out.map(x => x.id));
  const byId = new Map(out.map(x => [x.id, x]));
  const only = new Set();
  const seg = s => (s ? String(s).split(' · ').filter(Boolean).length : 0);
  let added = 0, richer = 0;
  for (const x of listItems) {
    if (has.has(x.id)) {
      const t = byId.get(x.id);
      /* 条数不许多、不许少，只许换：卡片那一路的类型永远是一段（topic_label 只取第一段大类），
         筛选页那一路给的是「大类 + 复合标签」，所以段数相同的时候也是它那一版更满。
         哪天卡片路自己多出第二段，这条 >= 就自动退回去，不会把多的换成少的。 */
      if (t && x.genre && x.genre !== t.genre && seg(x.genre) >= seg(t.genre)) { t.genre = x.genre; richer++; }
      continue;
    }
    out.push(x); has.add(x.id); only.add(x.id); added++;
  }
  /* only 交给集数那一队当「先敲这些」的名单 —— 这一路独有的条填率 21/26，卡片那一屏只有 8/100。 */
  return { items: out, added, richer, only };
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
            genre: qqGenre(p.topic_label), cast: qqCast(p.topic_label), castOk: false,
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
  /* 列表那一格只有一个名字的（庆余年/万花世界/风禾尽起张居正/武神岛 这种，也可能是赢风那种广告词）
     先敲门 —— 全池 7 条，一拍就扫完；剩下的按筛选页独有 → 站内次序排。 */
  const odd = new Set(items.filter(x => x.cast && x.cast.indexOf('、') < 0).map(x => x.id));
  const s = await fillEps(items, prevItems, qqDetail, m.only, x => x.eps == null || !x.castOk, odd);
  const wait = items.filter(x => !x.castOk).length;
  return { ok: true, items,
    note: `单子：待播卡片 ${cardCount} 条 + 即将上线筛选页 ${listItems.length} 条 → 新增 ${m.added} 条；`
      + `类型：从筛选页那一路接回复合标签 ${m.richer} 条（卡片那一路只给大类一段）；`
      + `集数：这一拍敲了 ${s.asked} 扇门、其中 ${s.ahead} 扇先给筛选页那一路（它独有的那些条腾讯填得最勤）、`
      + `腾讯填了 ${s.got} 部`
      + `（它自己留空的 ${s.blank} 部不再敲第二遍）、沿用上一轮 ${s.carried} 条；`
      + `主演：这一拍核了 ${s.kept + s.fixed + s.none} 条，列表那格对得上留着的 ${s.kept} 条、`
      + `对不上换成详情页名单的 ${s.fixed} 条、两边都没人的 ${s.none} 条`
      + `；全池还差 ${wait} 条没敲到门` };
}
// topic_label 形如「爱情|陈飞宇|张子枫」：第一段是类型，后面几段是主演 —— 但腾讯偶尔把宣传语塞进那几段
//   （赢风「剧情|情利交刃传奇开幕」、此刻的生活「都市|别墅区人心拉扯」，上一版 119 条里就有这 3 条）。
//   所以这里照它自己拼的次序取，取回来先不算认过（castOk=false），
//   等逐条那一扇门（qqDetail 的 star_list）对一遍才写字：列表那格第一个名字在 star_list 里 ⇒ 留着；
//   不在 ⇒ 那格填的不是人 ⇒ 换成 star_list 前四个。原来那版无条件 slice(1) 直接印，
//   页面上就出过「主演 情利交刃传奇开幕」——它不报错、不空屏，只是标签下面是别的东西。
const qqSplit = s => String(s || '').split('|').map(x => x.trim()).filter(Boolean);
const qqGenre = s => qqSplit(s)[0] || '';
const qqCast = s => qqSplit(s).slice(1).join('、');
// 筛选页那一路的 sub_title 是空格分隔的人名（实测「高至霆 金瀚 卜冠今 李嘉鑫」），同样偶尔是宣传语。
const qqCastSp = s => String(s || '').split(/\s+/).map(x => x.trim()).filter(Boolean).join('、');
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
   ⚠ 档期就在同一格里：定档了 onlineDesc 改口写「11月5日上线」（11-03 池子 144 条里《谷雨》那一条），
     没定档时那两格各写各的 —— onlineDesc=「即将上线」/ reason.text.title=「敬请期待」，
     定档时两格才是同一句话 ⇒ 认日期轮着读这两格。
     ⚠ 开播当天它会从「11月5日上线」改成「今天上线」（11-05 现场：两格一起改口，整池 144 条的取值
     就只有「即将上线/敬请期待」143 条 + 「今天上线」1 条这两种形状）⇒ 相对说法也认，见 ykDate。
     一个请求不多花：这一路本来每拍就整池翻八页。
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

/* 优酷的档期不是字段，是片单里那一句人话：「11月5日上线」。
   ⚠ 它只写月日、不写年份 ⇒ 今年拼出来那一天已经过了，再看差多少天：
       只差几天的不认 —— 「标还挂在即将上线、开播日刚过去」是这一池的常态（爱奇艺《夺金战》同一件事），
       认了就等于凭空造一个 300 天后的档期；
       差过半年才认成明年 —— 待播池不会挂一条去年今天的片子，它写 1 月 15 日而今天是 11 月，那是明年。
     自己写了年份、那一天却还在过去 ⇒ 也不认（和 iqReleaseDate 挡过去日期同一个守法）。
   ⚠ 「即将上线」「敬请期待」这两档认不出日期，回 null，不猜一个上去。
   ⚠ 空格要抹掉再解析：片单里是「11月5日上线」，show 页那个预约组件写的是「11月5日 上线」。
   ⚠ 开播当天它会改口写相对说法。这一条是 11-05 现场撞上的，不是推的：《谷雨》11-03 定档时写
     「11月5日上线」，11-05 早上同一格变成「今天上线」（`onlineDesc` 和 `reason.text.title` 两处一起变）。
     旧注释在这里写过一句「优酷没在片单里写过这种说法」—— 那是把「当时池里没有」当成了「这一家不给」，
     代价就是档期在开播当天被静默擦掉（他 11-05 报的「优酷排播数据消失了」是这一条，不是链路断）。
     ⇒ 相对说法按采集日推成绝对日期；推出来的日期落在 items 里，第二天它再改口时才有「原定 X」可对。
   ⚠ 只认「今天/今日/明天/明日/后天」起头、且句子里有「上线/开播/播出」的。光一个「今天」不认 ——
     那多半是别的模块蹭进来的句子，认了就等于替平台造一个档期。 */
const YK_REL = { 今天: 0, 今日: 0, 明天: 1, 明日: 1, 后天: 2 };
export function ykDate(s, today) {
  const t = String(s || '').replace(/\s+/g, '');
  const none = { date: null, time: null, text: '' };
  const isRef = /^\d{4}-\d{2}-\d{2}$/.test(String(today || '')) ? String(today) : bjDay(new Date());
  const hm = /(\d{1,2}):(\d{2})/.exec(t);
  const time = hm ? `${p2(Number(hm[1]))}:${hm[2]}` : null;
  const rel = /^(今天|今日|明天|明日|后天)/.exec(t);
  if (rel) {
    if (!/上线|开播|播出/.test(t)) return none;
    const [Y, M, D] = isRef.split('-').map(Number);
    const dt = new Date(Date.UTC(Y, M - 1, D + YK_REL[rel[1]]));
    return { date: `${dt.getUTCFullYear()}-${p2(dt.getUTCMonth() + 1)}-${p2(dt.getUTCDate())}`,
      time, text: String(s).trim() };
  }
  const m = /^(?:(\d{4})[年-])?(\d{1,2})[月-](\d{1,2})日?(?!\d)/.exec(t);
  if (!m) return none;
  const mo = Number(m[2]), dy = Number(m[3]);
  if (mo < 1 || mo > 12 || dy < 1 || dy > 31) return none;
  const ref = isRef;
  const iso = y => `${y}-${p2(mo)}-${p2(dy)}`;
  const year = m[1] ? Number(m[1]) : Number(ref.slice(0, 4));
  let v = iso(year);
  // 引擎对 2月30日 不报错，直接滚成 3月2日：滚完不再是原来那一天，就是拼不出日子
  const ms = Date.parse(v + 'T12:00:00+08:00');
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== v) return none;
  const d = Math.round((ms - Date.parse(ref + 'T12:00:00+08:00')) / 86400000);
  if (d < 0) {
    if (m[1] || d > -180) return none;
    v = iso(year + 1);
  }
  return { date: v, time, text: String(s).trim() };
}

// onlineDesc 是页面上那一句，reason.text.title 是同一格的另一路写法；定档时两句话一样，
// 没定档时各说各的 ⇒ 谁读得出日期用谁，都读不出就空着（不拿「即将上线」当它没档期的证据）。
function ykSpoken(x, today) {
  for (const s of [x.onlineDesc, ((x.reason || {}).text || {}).title]) {
    const r = ykDate(s, today);
    if (r.date) return r;
  }
  return { date: null, time: null, text: '' };
}

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
  const today = bjDay(new Date());
  const mapped = out.map(x => {
    const dt = ykSpoken(x, today);
    return {
      id: 'yk:' + x.reserve.id, platform: 'yk', title: String(x.title),
      genre: ykGenre(x.tags), cast: '', castOk: false,
      line: String(x.desc || '').replace(/\s+/g, '').slice(0, 60),
      count: num(x.reserve.count), hot: '',
      date: dt.date, time: dt.time, dateText: dt.date ? dt.text : '', eps: null,
      pic: httpsPic(x.img || x.hImg),
      url: 'https://www.youku.com/show/id_' + x.reserve.id + '.html',
    };
  });
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
  const today = bjDay(new Date());
  const out = [];
  for (const it of comp.itemList || []) {
    if (!it.title || !it.action_value) continue;
    const dt = ykDate(it.subtitle, today);
    out.push({
      id: 'yk:' + it.action_value, platform: 'yk', title: String(it.title),
      genre: ykGenre(it.tags), cast: '', castOk: false,
      line: String(it.desc || '').slice(0, 60),
      count: num((it.reserve || {}).count), hot: '',
      date: dt.date, time: dt.time, dateText: String(it.subtitle || ''), eps: null,
      pic: httpsPic(it.hImg || it.img),
      url: 'https://www.youku.com/show/id_' + it.action_value + '.html',
    });
  }
  if (!out.length) return { ok: false, msg: '「即将上线」组件是空的' };
  return { ok: true, items: dedupe(out) };
}

/* 优酷和腾讯这两家的集数不在待播那一路里，各在每部片子自己的详情页上，一家一个字段：
   优酷 www show 页的 "episodeTotal"（11-02 起门从 m 站挪上来，因为主演名单只在那一页里 ——
     m 站那张 6 万字的页面压根没有演员这一项，主演只出现在 showSubtitle 那句宣传语里）；
   腾讯 详情页 getPage 的 pc_introduction 卡 params.episode_all（一条 6~11 万字节）。
   ⚠ 一部一个请求 ⇒ 池子 126/144 部全取一遍就是 126/144 个请求，跟固定那 120 发一个量级。
      所以每家每拍各只补「还没有数」的前 EPS_MAX 条，按站内次序 —— 靠前的正是页面上先看见的。
      铺满一遍：腾讯约 12 拍、优酷约 12 拍，之后每拍只碰新进池的那几条。
   ⚠ 腾讯这一家把「列表那一格只有一个名字的」提到队列最前（11-02 全池 7 条），再排「筛选页独有的那几条」
      （它独有的 26 条填了 21 条，卡片那一屏 100 条只填 8 条）：
      按站内次序排要第九拍才轮到它们，等于那 21 个数字白等多六天。⇒ 头几拍基本砸在这两档上，
      卡片那一屏反倒后有。代价是卡片那一屏自己从第九拍推到第十一拍 ——
      那一屏填率本来就低，多等的两拍里压着的数没几个。
   ⚠ 11-02 起腾讯那一扇门多核一项「主演」（同一张 pc_introduction 卡上的 star_list，一个请求不多花）：
      排队判据从「还没有集数」放宽成「集数或主演还欠着」⇒ 上传后的头 12 拍门数不变、但全砸在重走上，
      这期间腾讯的集数补数会慢下来。和芒果那一版多排「类型」是同一个改法、同一笔账。
      这一版不清库、不空栏：列表那一格照旧印（上一版 119 条里 116 条本来就是主演，不能为 3 条广告词把它们抹了），
      门敲到的那一条才对它下判断 —— 对得上留、对不上换成详情页名单。⇒ 那 3 条广告词第一拍就没了（排在队首），
      其余的在一两天里逐条盖上「核过」这一章；没盖到的那几天里，那一栏是「腾讯列表自己填的、还没对过名单」。
   ⚠ 11-02 深夜这一栏从两家变四家：优酷在同一扇门里多读 person[]（type=performer 的那几个），
      芒果在同一扇门里多读「演员：」那一格 ⇒ 请求数一个不多花，但两家的排队判据都放宽成「主演还欠着」，
      所以上传后的头几拍这两家的门全砸在重走上（优酷 144 条 ≈ 12 拍、芒果 47 条 ≈ 4 拍；
      一天四拍 ⇒ 芒果当天铺完、优酷次日铺完），这期间它们的集数补数会慢下来 —— 和腾讯那一版是同一笔账。
      这两家不存在「列表那一格」可核对：池子整条没有主演字段（cast 一律是空串），
      所以门敲到的那一条直接写详情页给的名单，castOk 记「这一条的名单是从页上读的」，不是「对过别人的」。
      ⚠ 优酷页里另有现成的 "_personNameArr" 一格，看着比 person[] 好抽，但它掺导演和原著作者
      （恋人 =「赵露思、彭冠英、邓科」，邓科是导演；少年歌行2之南明离火 整格是「尹涛、周木楠、周木楠」=
      导演+原著+编剧，那一页一个演员都没填）⇒ 只许按 type 取 performer，宁可空着也不印导演。
      芒果那一格的键号会错位（上星剧多插一条「电视台：」，演员从键 3 挪到键 4）⇒ 只许按「演员：」这个标签取。
   ⚠ 「这一家自己没填」两家写法不同：优酷是 "episodeTotal":0，腾讯是空串。两个都归成 eps=0
      留下（页面拿不到就不印），不然每拍都在重敲同一批没人接的电话。
   ⚠ 代价摆在这里：一条现在写 0 的片子，平台后来改口公布了集数，光靠「问过一次」是看不见的。
      改口基本发生在定档那一刻 ⇒ 上一拍还没档期、这一拍有了，就把那个 0 放回「没问过」重新排队。
      没定档的那些不重敲，那是 100 个请求换 8 个数的那笔账。
      11-03 起这一条对优酷也生效了（它的档期和池子同一发拿到；之前 date 恒空 ⇒ 这一支对它一次也没触发过）。 */
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
   每拍 12 扇门按站内次序敲要第九拍才轮到它们，那 21 个数字白白多等六天。
   head 比 first 还要靠前，只在这一版铺主演的时候有货：列表那一格只有一个名字的（11-02 全池 7 条），
   那 7 条分不清是「就一个主演」还是「填的是一句宣传语」—— 上一版页面上那 3 条广告词全在这一档里。
   把它排在最前不是靠猜把人名挑出来，只是决定先敲哪几扇门；敲开之后仍按 checkCast 对名单。
   pending 是「这一条还欠什么」的判据，不传就是只欠集数；腾讯那一版还欠主演核对（同一扇门两个数，见 qqDetail）。 */
export function pickEps(items, max, first, pending, head) {
  const todo = items.filter(pending || (x => x.eps == null));
  const rest = x => !((head && head.has(x.id)) || (first && first.has(x.id)));
  if (!head || !head.size) {
    if (!first || !first.size) return todo.slice(0, max);
    return todo.filter(x => first.has(x.id))
      .concat(todo.filter(x => !first.has(x.id))).slice(0, max);
  }
  return todo.filter(x => head.has(x.id))
    .concat(todo.filter(x => !head.has(x.id) && first && first.has(x.id)))
    .concat(todo.filter(rest)).slice(0, max);
}
/* 核过的主演才许带到下一拍（castOk 是那一扇门的记号，不是列表给的）。
   不带这个记号会坏在两处：下一拍列表那一格又把同一句广告词写回来（赢风那种换了来源也不见底），
   以及已经换成详情页名单的那一条被列表值倒回去。 */
export function carryCast(items, prevItems) {
  const prev = new Map((prevItems || []).map(x => [x.id, x]));
  let kept = 0;
  for (const x of items) {
    const p = prev.get(x.id);
    if (!x.castOk && p && p.castOk) { x.cast = p.cast || ''; x.castOk = true; kept++; }
  }
  return kept;
}
/* 优酷 www show 页里「谁演的」有两个现成的格子，只许信带类型的那一个：
   "_personNameArr" 是这片子头几号人物的混排 —— 恋人 那一格第三个是导演邓科、旷野之境 那一格第四个是导演林柯、
   少年歌行2之南明离火 整格是「尹涛、周木楠、周木楠」（导演 + 原著 + 编剧，那一页一个演员都没填）；
   同一个页里的 person[] 每条自带 type，performer 才是演员（director/original/screenwriter 是导演/原著/编剧）。
   ⚠ 一条对象里键的顺序不固定，所以认的是「name 和 type 在同一条里挨着出现」，中间不许跨过花括号 ——
     跨了就会把上一位的 name 配到下一位的 type 上。名单可能重复出现（同一页里 person[] 摊了两遍），去重。 */
export function ykPerformers(html) {
  const out = [];
  const re = /"name":"([^"]{1,24})"[^{}]{0,220}?"type":"performer"/g;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const n = m[1].trim();
    if (n && out.indexOf(n) < 0) out.push(n);
  }
  return out;
}
/* 芒果那一页的 videoinfo 是一格一格的："0":"类型：电视剧"、"2":"导演：杨文军"、"3":"演员：檀健次 \u002F 卢昱晓 …"。
   ⚠ 键号会变：上星剧多插一条 "电视台：" 就把演员顶到键 4（咸鱼飞升、大梦想家 都是这一种），
     所以按「演员：」这个标签认、不按键号 —— 11-02 抽 16 条，按键号 14/16，按标签 16/16。
   ⚠ 分隔符在页里是写成反斜杠的 \u002F（不是斜杠），两种都认；取前四个，和腾讯那一栏一样宽。
   「演员：」这一格在那一页上出现两次（同一段 videoinfo 被内嵌了两遍），两份内容逐字一致 ⇒ 取第一处。 */
export function mgCast(html) {
  const m = /"演员：([^"]*)"/.exec(String(html || ''));
  if (!m) return '';
  // 先逐个削掉占位再取前四个：那一格整格写「未知」的（11-03 线上芒果 7 条）不许占一个人名位。
  return m[1].split(/\s*(?:\\u002F|\/|、|,)\s*/).map(s => noUnknown(s)).filter(Boolean).slice(0, 4).join('、');
}
/* m 站那一张（6 万字节）没有主演名单，只有同一个 episodeTotal ⇒ 只当 www 没敲门成功时的退路。 */
async function ykEpsM(x) {
  try {
    const r = await get(`https://m.youku.com/alipay_video/id_${x.id.slice(3)}.html`,
      { headers: { 'user-agent': MG_UA, referer: 'https://m.youku.com/' } });
    const m = /"episodeTotal":(\d+)/.exec(r.body || '');
    return m ? { eps: Number(m[1]) } : null;
  } catch (e) { return null; }
}
/* 优酷这一扇门一次给两个数（同一页、同一个请求）：集数 episodeTotal、主演 person[] 里的 performer。
   ⚠ www 那张页被优酷自己的反爬掐掉时回的是 1,529 字节的跳转（页里写着 _____tmd_____/punish、action:captcha），
     那是「门没开」，不是「优酷没填」：既不许多记一个 eps=0，也不许盖 castOk —— 盖了就等于把这一条永久留在空栏，
     再也不会回来敲。所以长度这道闸门过不了就整发退回 m 站那一发（只拿集数，主演下一拍再来）。
   ⚠ 反过来「页拿到了、那一格里就是没有演员」（藏海传2：15 条完整页里唯一这一条）要盖上 castOk、
     名单留空 —— 它和 eps 记 0 是同一种守法，不然这一条每拍都占一扇门。 */
async function ykDetail(x) {
  try {
    const r = await get(`https://www.youku.com/show/id_${x.id.slice(3)}.html`,
      { headers: { 'user-agent': UA, referer: 'https://www.youku.com/' } });
    const body = r.body || '';
    if (body.length > 20000) {
      const m = /"episodeTotal":(\d+)/.exec(body);
      return { eps: m ? Number(m[1]) : null, names: ykPerformers(body) };
    }
  } catch (e) { /* 落 m 站那一发 */ }
  return await ykEpsM(x);
}
/* 腾讯逐条那一扇门一次给两个数：集数在 episode_all，主演名单在 star_list。
   ⚠ star_list 是腾讯自己拼的一段 JSON 字符串（[{"name":"万鹏","id":"…","vuid":"…"},…]），
     11-02 拿他截图那三条核过：赢风回「万鹏、张弛、迟蓬、黄景瑜」正是 App 详情页那一排。
   ⚠ 但它不是「主演」名单而是「主创」名单：导演、编剧、原著作者混在里面，还常排在头一个
     （大唐辟珠记第一位是导演费振翔、35而已 那两个是导演+编剧、来战第四位是原著作者九鹭非香）。
     所以这一扇门给的是核对用的名单（names），不是直接往页面上印的那一行。
   ⚠ 那一格是空数组、或者压根不是合法 JSON 时也算敲过了（names 回空数组），
     下一拍不再为它开门 —— 和 episode_all 那个空串归 0 是同一种守法。 */
async function qqDetail(x) {
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
      const p = c.params || {};
      const v = String(p.episode_all || '').trim();
      let names = [];
      try {
        const s = JSON.parse(p.star_list || '[]');
        if (Array.isArray(s)) names = s.map(a => a && a.name).filter(Boolean);
      } catch (e) { /* 那一格畸形 = 问过了、拿不出人名 */ }
      return { eps: v === '' ? 0 : (Number(v) || 0), names };       // 空串 = 腾讯自己没填，也算问过了
    }
  return null;                                       // 连简介卡都没有 ⇒ 当没敲过，下一拍再试
}
/* 列表那一格（卡片路 topic_label 尾段 / 筛选页 sub_title）和详情页那份主创名单对一遍：
   列表那格的第一个名字能在 star_list 里找到 ⇒ 它填的是人，留着（它反倒把导演排掉了：大唐辟珠记
   列表=「田曦薇、宋威龙」，star_list 头一个是导演费振翔）；
   找不到 ⇒ 那一格塞的是宣传语（赢风=「情利交刃传奇开幕」），换成 star_list 前四个 ——
   那是腾讯自己在 App 详情页同一排上印的东西，不是我挑的；
   两边都拿不出人 ⇒ 空着，不印。 */
export function checkCast(x, names) {
  const got = (x.cast || '').split('、').filter(Boolean);
  if (got.length && names.includes(got[0])) return 'kept';
  if (names.length) { x.cast = names.slice(0, 4).join('、'); return 'fixed'; }
  return 'blank';
}
async function fillEps(items, prevItems, detailOf, first, pending, head) {
  const carried = carryEps(items, prevItems) + carryCast(items, prevItems);
  const todo = pickEps(items, EPS_MAX, first, pending, head);
  let got = 0, blank = 0, kept = 0, fixed = 0, none = 0, named = 0;
  for (let i = 0; i < todo.length; i += 4) {
    const rs = await Promise.all(todo.slice(i, i + 4).map(detailOf));
    rs.forEach((r, k) => { const x = todo[i + k];
      if (r == null) return;                          // 门没开：两个数都算没问过，下一拍再敲
      if (r.eps != null) { x.eps = r.eps; if (r.eps > 0) got++; else blank++; }
      if (r.names) {                                  // 腾讯/优酷这两扇带名单；芒果的门另走一路（它一次给四个数）
        if (r.names.length) named++;
        const v = checkCast(x, r.names);
        x.castOk = true;
        if (v === 'kept') kept++; else if (v === 'fixed') fixed++; else none++;
      } });
  }
  return { carried, asked: todo.length, got, blank, kept, fixed, none, named,
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
  /* 排队判据和腾讯那一版同一个写法：「集数或主演还欠着」。
     优酷池子整条没有主演字段（那两路给的都是 cast=''），所以 castOk 认的是「这一条的名单是从页上读的」，
     没盖到章的那些沿用上一轮 carryCast 接回来的 —— 门每拍只有 12 扇，池子 144 条。 */
  const s = await fillEps(r.items, prevItems, ykDetail, null, x => x.eps == null || !x.castOk);
  const wait = r.items.filter(x => !x.castOk).length;
  const dated = r.items.filter(x => x.date);
  r.note = `${r.note ? r.note + '；' : ''}集数：这一拍敲了 ${s.asked} 扇门、优酷填了 ${s.got} 部`
    + `（它自己写着 0 的 ${s.blank} 部不再敲第二遍）、主演读到名单 ${s.named} 条`
    + `（那一页真没填演员的 ${s.none} 条记「问过了」不再敲）、沿用上一轮 ${s.carried} 条`
    + `；全池还差 ${wait} 条没敲到门`
    + `；档期：这一拍 ${dated.length} 条写了上线日`
    + (dated.length ? `（${dated.map(x => x.title + ' ' + x.date).join('、')}）` : '');
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
    /* 类型走公共那把尺子（上限 3 枚）：日历那一路给的是芒果自己的 tag 数组，11-03 实测
       54 条里 2 枚 20 条、3 枚 28 条、4 枚 6 条（一枕春澜「古装 · 复仇 · 爱情 · 权谋」= 17 字）。
       那一行（.sb）是 nowrap + 省略号，第四枚会把「主演」挤出可见区 —— 和腾讯、爱奇艺同一笔账。 */
    genre: genreText('', i.tag || []), cast: '', castOk: false,
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
/* 芒果的类型只在日历那一路的 info.tag 里（11-03 他点着「咸鱼飞升」「今天是太阳雨」问：是不是没敲到门）——
   不是没敲到，是那一扇门里压根没有这一格：mgDetail 回的是 count / eps / kind / cast 四格，
   那个 kind 是「电视剧 / 电影 / 动漫少儿」的大类（剔电影用的），不是片名底下那一串类型。
   而这两条偏偏就在 dedupe 上丢了：日历那两发每拍都在拉，83 条里 82 条带 tag（11-03 实测 pbid=8 的 32 条全带、
   pbid=9 的 51 条带 50 条），咸鱼飞升 =「修仙 · 传奇」、今天是太阳雨 =「青春 · 爱情 · 励志」都在里面 ——
   可 dedupe 把屏内那一路排在前面（pos 认的是那一屏的次序），同一部片留下的是屏内那一份，
   它那一句 genre: '' 正好把日历给的那串顶掉。11-03 线上档案 芒果 47 条里 9 条空着，那 9 条全是屏内那一路的
   （那一屏当天 10 条，剩下的一条 八仙！ 那拍还不在档案里）；这 10 条再敲多少遍门也不会有类型。
   11-03 接完实跑：屏内 10 条全部对得上日历，接回 9 条，池子 55 条里剩 1 条空着 =「天猫疯狂好六夜」，
   它那一发日历自己 tag 是空数组 —— 那是芒果没写，照实空着，不猜。
   并法照腾讯那一段的守法：次序、档期、简介仍以屏内为准，只把类型这一格从日历那一份接回来，
   一个请求不多花（日历那两发本来每拍就拉）。
   ⚠ 屏内那一路自己给不出这一格：11-03 摊开一条行看过，27 个键里没有一个像类型的
     （dataType / jumpKind 是「这是不是电视剧」那一档，不是类型串）。 */
export function mergeMgGenre(screen, feed) {
  const by = new Map((feed || []).filter(x => x && x.id && x.genre).map(x => [x.id, x.genre]));
  let n = 0;
  for (const x of (screen || [])) if (x && !x.genre && by.has(x.id)) { x.genre = by.get(x.id); n++; }
  return n;
}
async function fetchMG(prevItems, prevOff) {
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
  // 但类型那一格得先从日历那一份接回来再丢，见上面 mergeMgGenre 那一段。
  const tagged = mergeMgGenre(screen, feed);
  const raw = dedupe([...screen, ...feed]);
  /* 他 10-26 点的：芒果这一格只要电视剧。大类是逐条那一扇门认出来的，所以头几拍池子里还会看见电影，
     认出来才搬出去 —— 搬出去的记进 off 这份备忘，下一拍不再给它开门，也不算「出池」（见 build 那一段）。 */
  const off = mgPrune(prevOff, raw);
  const items = raw.filter(x => !off[x.id]);
  const f = await fillMGDetail(items, prevItems, off);
  const kinds = Object.values(off);
  const byKind = {};
  for (const k of kinds) byKind[k] = (byKind[k] || 0) + 1;
  const waiting = items.filter(x => x.kind == null).length;
  const noGenre = items.filter(x => !x.genre).length;
  return { ok: true, items, off,
    note: `单子：首页屏内 ${screen.length} 条 + 日历 ${feed.length} 条 → 去重 ${raw.length} 条`
        + (dead.length ? `（日历没接上：${dead.join('；')}）` : '')
        + ` → 芒果标成电视剧以外的 ${Object.keys(off).length} 条不搬进来，池子 ${items.length} 条`
        + (waiting ? `（其中 ${waiting} 条还没敲到门认大类，下一拍接着认）` : '')
        + `；类型：从日历那一路接回 ${tagged} 条（屏内那 ${screen.length} 条自己不带这一格），池子里仍没类型的 ${noGenre} 条`
        + (kinds.length ? `；剔掉的按芒果自己的分类：${Object.entries(byKind).map(([k, n]) => `${k} ${n}`).join('、')}` : '')
        + `；这一拍敲了 ${f.asked} 扇门、预约数拿到 ${f.got} 条（集数顺带 ${f.eps} 条、大类认出 ${f.typed} 条 + 那一页标题不是那个形状的 ${f.unmarked} 条、主演读到 ${f.named} 条，没给的都记「问过了」不再敲）、沿用上一轮 ${f.carried} 条` };
}
/* 这一家的预约数和集数在同一个那一页上，所以只有一扇门：敲一次两跳，四个数一起拿
   （预约数、集数、大类、主演）。十个一开就是 20 个并发请求砸人家 CDN，按 4 个一批走。 */
/* 大类也算一扇门的账：已经在档案里填满预约数和集数的那 21 条，若只按「缺数」排队，
   它们再也进不了队列，于是永远认不出大类、电影永远留在单子里（10-26 沙箱实跑抓到的）。
   主演是同一笔账的第二次：11-02 只按「缺数或没大类」排队的话，档案里那 47 条已经齐了的永远进不了门，
   页面上「主演」那一栏就永远是空的 —— 而且它不报错、不空屏，看上去跟平台没填一模一样。
   ⚠ 这一栏里没有「类型」：那一扇门从头到尾不给类型串，它在日历那一路的 tag 里，见 mergeMgGenre。 */
export function mgQueue(items, max) {
  return items.filter(x => x.count == null || x.eps == null || x.kind == null || !x.castOk).slice(0, max);
}
/* 认完大类这一步单独可测 —— 它同时管着两件容易写反的事：
   一是「认不准就别剔」（kind 为 null 是没敲到门，'未标' 是敲到了但页上没这个形状，两者都不是「不是电视剧」），
   二是剔掉的必须落进 off 那份备忘，不然下一拍它又回到敲门队列里，白占一扇门。
   留下来的条目把 kind 原样留在身上：池子每拍是从站内重新摊开的，靠 carryKind 把它接回来，
   不然 12 扇门永远只敲前 12 条，第 13 条到第 51 条一排都认不到。 */
export function mgSplit(items, off) {
  let cut = 0;
  for (let i = items.length - 1; i >= 0; i--) {
    const x = items[i];
    if (x.kind && x.kind !== '电视剧' && x.kind !== '未标') { off[x.id] = x.kind; items.splice(i, 1); cut++; }
  }
  return cut;
}
export function carryKind(items, prevItems) {
  const prev = new Map((prevItems || []).map(x => [x.id, x]));
  let kept = 0;
  for (const x of items) {
    if (x.kind != null) continue;
    const p = prev.get(x.id);
    if (p && p.kind != null) { x.kind = p.kind; kept++; }
  }
  return kept;
}
/* off 只留「这一拍池子里还在的那些」：一部片子从芒果待播池撤下去，它跟着从备忘里掉出去 ——
   不然备忘只会越长越大，哪天它又回来还得不上门问一遍。代价是它回来那一拍要重敲一扇门认大类，一扇门而已。 */
export function mgPrune(off, pool) {
  const inPool = new Set(pool.map(x => x.id));
  const out = {};
  for (const [id, kind] of Object.entries(off || {})) if (inPool.has(id)) out[id] = kind;
  return out;
}
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
async function fillMGDetail(items, prevItems, off) {
  const carried = carryEps(items, prevItems) + carryCounts(items, prevItems) + carryKind(items, prevItems)
    + carryCast(items, prevItems);
  const todo = mgQueue(items, MG_DOOR_MAX);
  let got = 0, eps = 0, typed = 0, unmarked = 0, named = 0;
  for (let i = 0; i < todo.length; i += 4) {
    const rs = await Promise.all(todo.slice(i, i + 4).map(x => mgDetail(x.id.slice(3))));
    rs.forEach((r, k) => {
      const x = todo[i + k];
      if (r.count != null) { x.count = r.count; got++; }
      if (r.eps != null) { x.eps = r.eps; if (r.eps > 0) eps++; }
      if (r.kind) { x.kind = r.kind; if (r.kind === '未标') unmarked++; else typed++; }
      /* 主演和大类是同一页、同一次敲门；那一页没写演员就记空串 + 盖章（问过了），
         不然这一条每拍回来占一扇门，12 扇门永远铺不完 47 条池子。 */
      if (r.cast != null) { x.cast = r.cast; x.castOk = true; if (r.cast) named++; }
    });
  }
  const cut = mgSplit(items, off);
  return { carried, asked: todo.length, got, eps, typed, unmarked, named, cut };
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
/* 芒果这两路（首页模块 + 新片日历）整份回话里**一个大类字段都没有** —— 51 条逐条摊开看过，
   dataType / jumpKind / status 三条全表同一个值（1 / 1 / 0），拿它们分不出剧和电影。
   ⚠ 这一句只管「大类」（电视剧 / 电影 / 动漫少儿），别读成「芒果不给类型」：片名底下那一串类型
     在日历那一路的 info.tag 里，11-03 实测 pbid=8 的 32 条全带、pbid=9 的 51 条带 50 条，
     见上面 mergeMgGenre 那一段。这两件事旧注释都写成「类型」，害我自己也读错过一次。
   大类在逐条那一扇门的第二跳上：那一页的 <title> 末段就是芒果自己给的那一档。
   ⚠ 尾巴有两种，只照着电视剧那一种写就把电影整批漏掉（10-26 沙箱实跑撞到的）：
      电视剧 —— 咸鱼飞升-《咸鱼飞升》预约200万福利！…-电视剧-全集高清视频-芒果TV
      电影 —— 《蜘蛛侠：崭新之日》口碑特辑 第一视角打造沉浸体验-电影-最新高清视频在线观看-芒果TV
      动漫 —— 搜神-《搜神》片花：国风奇幻志怪世界-动漫少儿-最新高清视频在线观看-芒果TV
   这一跳本来就为了预约数和集数在敲，顺手多读一个字段，一个请求都不多花。
   ⚠ 认的是**芒果自己标的这一档**，不是我看着片名猜的：《风起玲珑骨 第一季》改编自漫画、
      日历那一路的 tag 写着「仙侠 · 玄幻」，芒果自己把它归在「电视剧」，那就收进来 —— 我拿它当动漫剔掉才是造假。
   ⚠ 也试过拿日历那一发的 pbid 当大类（pbid 10 那 6 条里认得出的 3 条全是电影），没用它：
      芒果没说 10 就是「电影档」，那是我猜的 —— 要的是它自己写下的那一档。
   认不出来（标题不是这个形状）返回 null —— 这一档**不许**当「不是电视剧」剔掉；mgDetail 把它记成 '未标'，
   条目留在单子里，只是不再占门。 */
export function mgKind(html) {
  const m = /-(电视剧|电影|动漫少儿|综艺|纪录片|少儿|亲子|教育|漫画|短剧)-(?:全集高清视频|最新高清视频在线观看)-芒果TV/.exec(String(html || ''));
  return m ? m[1] : null;
}
async function mgDetail(aid) {
  const out = { count: null, eps: null, kind: null, cast: null };
  try {
    const hop = await get(`https://m.mgtv.com/b/${aid}`, { headers: { 'user-agent': MG_UA } });
    const m = /url=(https?:\/\/m\.mgtv\.com\/b\/\d+\/\d+\.html)/.exec(hop.body || '');
    if (!m) return out;                     // 连壳都没给跳转 ⇒ 当没敲过，下一拍再试
    const page = await get(m[1], { headers: { 'user-agent': MG_UA } });
    if (!page.body || page.body.length < 2000) return out;   // 真页没拿到，同样当没敲过
    /* 页拿到了、标题却不是那个形状 ⇒ 记 '未标'（＝问过了、芒果没这么写），和 eps 记 0 是同一个处理：
       留成 null 它每拍都回来占一扇门，51 条只有 12 扇，后面的永远认不到。
       '未标' 的条目仍然留在单子里 —— 认不准就不剔。 */
    out.kind = mgKind(page.body) || '未标';
    /* 主演在这同一页的 videoinfo 里（"演员：檀健次 \u002F 卢昱晓 …"），一个请求不多花。
       认不到那一格 ⇒ 记空串（＝问过了、芒果这一页没写演员），和 eps 记 0、kind 记 '未标' 是同一种守法；
       留 null 就等于每拍回来占一扇门。 */
    out.cast = mgCast(page.body);
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
    genre: '', cast: '', castOk: false,
    line: String(r.stroy || '').replace(/\s+/g, '').slice(0, 60),
    count: null, hot: '', date, time, dateText: String(r.beginTime || ''), eps: null,
    pic: httpsPic(r.imgHor || r.imgVer || r.img),
    url: String(r.url || `https://www.mgtv.com/b/${r.aid}`),
  };
}

// ---------- 爱奇艺 ----------
// 三条路各管一栏，全匿名：
//   A 路（recommend/list）：整池九十多条的片名/主演/集数/海报/站内次序，一个日期字段都没有。
//     ⚠ 它的 categories（类型）不给全：11-03 整池 99 条里 56 条是空数组，空的那些条 D 路补。
//   C 路（countAndState）：预约人数精确整数，一发带 60 个 albumId。
//   D 路（search/homePageV3）：档期，顺带类型和真正的专辑页地址。
//     一条一个请求（它按片名搜，没有批量口），见下面那一节。
// 三条路的 albumId 互通：D 路回话里的 qipuId 就是 A 路的 albumId（11-02 整池 92/92 逐条对上）。
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
        genre: genreText('', x.categories || []),
        cast: (((x.people || {}).main_charactor) || []).map(a => noUnknown(a && a.name)).filter(Boolean).slice(0, 4).join('、'),
        line: String(x.focus || x.description || '').replace(/\s+/g, '').slice(0, 60),
        count: null, hot: '', date: null, time: null, dateText: '', eps: num(x.videoCount),
        // A 路给不出专辑页地址（a_<albumId> 那种拼法实测 404），先退到站内搜索；
        // D 路对上以后、且它那一发真带回 a_ 那张专辑页时才换过去，见 iqAlbumUrl。
        // ⚠ 参数是 q=：keyword= 那一版点开是「抱歉，没有找到相关视频」（11-03 他撞上的），
        //   同一个站，搜索页只认 q=。
        pic: httpsPic(x.imageUrl),
        url: 'https://www.iqiyi.com/search?q=' + encodeURIComponent(String(x.name)),
      });
    }
    if (!((j.data || {}).has_next)) break;
  }
  if (!pages) return { ok: false, msg: '爱奇艺 recommend/list 一条都没回' };
  const d = dedupe(out);
  if (d.length < 30) return { ok: false, msg: `爱奇艺只回了 ${d.length} 条，比平时（九十多条）少太多，这轮不用` };
  const got = await fillIQCounts(d);
  const b = await iqDates(d);
  const note = `预约人数取到 ${got}/${d.length} 条（一发带 60 个 albumId）` + '；' + b.msg;
  return { ok: true, items: d, note, spoken: b.spoken };
}

/* C 路：预约人数。全匿名 —— 不带 cookie、不带 dfp、不带 device_id。
   subKeys 收 albumId（也收 tvId，同一个实体两个键回同一个数，两京十五日 1258223 / 它的 tv 1258222），
   所以 A 路那 98 条直接就能问，这一路和档期那一路通不通也无关。
   ⚠ subType 必须是 2：给 1 或 3 回的是 count:0，code 照样是 A00000，看着像成功、其实是空的。
   拿到的数和 D 路那句「预约破100万」档位文字逐条对得上（来战 301.7万 / 云襄传之将进酒 201.4万 /
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

/* D 路：爱奇艺的档期（11-02 起走这一路，B 路 videolib/data 死了 —— 见下面那段考古）。
   全匿名：不带 device_id、不带 token、不带 cookie；UA / referer 给不给、换成 App 的 UA，回的是同一份。
     GET mesh.if.iqiyi.com/portal/lw/search/homePageV3?key=<片名>&mode=1&pageNum=1&pageSize=25
   回话 data.templates[] 每条挂一个 albumInfo，认 channel==='电视剧,2' 且 qipuId===albumId 的那一条 ——
   是按 ID 硬对上的，不是按片名猜（11-02 整池 92 条：92/92 ID 对上，0 条靠名字）。两个字段同进同退：
     releaseTime.value  排上档期 → '2026-11-05'；没排上 → 只给一个年份 '2026'（占位，不算档期）
     startUpdateTime    排上档期 → '本周四18:00上线'；没排上 → '即将上线'
   92 条里这两格无一例外地一起变，所以拿 releaseTime 当档期、拿 startUpdateTime 里的时刻填 time。
   同一份 albumInfo 还顺手给两栏（11-03 接上，一个请求不多花）：
     tags      A 路 categories 空着的那些条，类型补这里（整池 99 条：A 空 56、D 对上 97 且全有值）
     pageUrl   真正的专辑页地址，只在它是 a_xxx.html 那一种时拿来替掉站内搜索
   ⚠ 它按 key 搜、没有批量口 ⇒ 一条一个请求，整池 92 发/拍，是四家里最贵的一路。
     按 4 个一批走（和优酷/腾讯/芒果那三扇门同一个守法），实测整池 16 秒、连打 12 发零异常。
   ⚠ 少回一大截就不算这一路回了话：对上的不足 30 条就交 null 当「这一拍没问到」，
     让 build() 把上一轮的日期原样留着 —— 拿一张残缺的搜索结果覆盖整池档期，
     在 diff 里就成了「今天爱奇艺把 5 部的档期撤了」，那是假事。 */
async function iqDates(items) {
  const VER = '17.111.26799';
  const today = bjDay(new Date());
  const spoken = new Set();
  let dated = 0, past = 0, miss = 0, typed = 0, linked = 0;
  const names = [];
  const one = async (x) => {
    const id = x.id.slice(3);
    const uu = 'https://mesh.if.iqiyi.com/portal/lw/search/homePageV3?key=' + encodeURIComponent(x.title)
      + `&current_page=1&mode=1&source=location&pageNum=1&pageSize=25&pcv=${VER}&version=${VER}`;
    let j;
    try {
      const r = await get(uu, { headers: { 'user-agent': UA, 'referer': 'https://www.iqiyi.com/' } });
      j = JSON.parse(r.body);
    } catch (e) { miss++; return; }
    const list = (j || {}).data && (j.data).templates;
    if (!Array.isArray(list)) { miss++; return; }
    const a = list.map(t => t && t.albumInfo).filter(y => y && y.channel === '电视剧,2')
      .find(y => String(y.qipuId) === id);
    if (!a) { miss++; return; }          // 搜到一堆别的、没搜到这一条 ⇒ 不算问过这一条，它的旧日期留着
    spoken.add(x.id);
    // 这两栏在日期之前填：整池 92 条里此刻只有几条排得上档期，放在 !dt 那句 return 后面就白填了。
    if (!x.genre) { const g = genreText('', iqGenreTags(a)); if (g) { x.genre = g; typed++; } }
    const page = iqAlbumUrl(a);
    if (page && x.url !== page) { x.url = page; linked++; }
    const raw = iqReleaseDate(a);
    const dt = iqReleaseDate(a, today);
    if (raw && !dt) past++;              // 它写着日期，但那一天已经过去了
    if (!dt) return;
    x.date = dt; x.dateText = dt; dated++;
    const hm = iqTimeText(a); if (hm) x.time = hm;
    const tag = (a.specialTags || []).map(t => t && t.text).filter(Boolean).join('、');
    if (tag && !x.hot) x.hot = tag;      // C 路断了才用得上那句「预约破100万」
    names.push(`${x.title} ${dt}`);
  };
  for (let i = 0; i < items.length; i += 4) await Promise.all(items.slice(i, i + 4).map(one));
  if (spoken.size < 30) return { spoken: null,
    msg: `D 路（搜索口）只对上 ${spoken.size}/${items.length} 条、${miss} 条没回或没搜到，比平时少太多，这一轮当没问到` };
  return { spoken,
    msg: `D 路对上 ${spoken.size}/${items.length} 条，其中带真档期 ${dated}${names.length ? '（' + names.join('、') + '）' : ''}`
      + `；类型补上 ${typed} 条（A 路 categories 空的那些）、片名链接换成官网专辑页 ${linked} 条`
      + (past ? `；另有 ${past} 条写的开播日已经过去了，没当档期收` : '')
      + (miss ? `；${miss} 条没搜到对应那条，它们的旧档期原样留着` : '') };
}
/* ── 爱奇艺的类型为什么在这一发里（11-03 他指着「重症监护 = 医疗题材」问：官网上有，屏上怎么空着）──
   A 路 recommend/list 的 categories 整池 99 条里 56 条是空数组（11-03 实测，重症监护就是其中一条），
   而本来就在发的 D 路那一发，albumInfo.tags 对上的 97 条全有值 —— 那一排正是官网印在片名底下的
   （重症监护 tags = 医疗题材 · 剧情，跟他截图那枚红框一字不差）。所以补它一个请求不多花。
   ⚠ 两套口径不并成一串：同一部片 A 给「言情 · 青春 · 剧情」、D 给「暗恋 · 都市爱情 · 爱情」，
     拼起来就是爱奇艺自己没有的类型。所以只在 A 空的时候用 D 补，A 有值的一个字不改
     （42 条两边都有值的逐条对过，A、D 说法没有一条是同一串）。
   ⚠ 不用比 tags 更长的那格 baseTags：它往里掺「当代」「内地」这种时代、区域标，
     和页面上片名底下那一排不是一回事。
   削到 3 枚、被包住的短串丢掉，走 genreText 那把和腾讯同一样的尺子。 */
export const iqGenreTags = a => ((a || {}).tags || []).map(t => t && t.text).filter(Boolean);
/* D 路那一发顺手带回真正的专辑页地址。只认 a_xxx.html 那一种：
   11-03 整池对上的 97 条里，20 条给 a_（点开就是这部片子那一页：实测 200、约 30 万字节、
   <title> 是「自首真相-电视剧-高清正版视频在线观看」），77 条给 v_（单集/预告播放页：
   实测也 200，但两条都是 64,482 字节的同一份空壳，<title> 是那句泛的「爱奇艺-在线视频网站」）。
   ⇒ v_ 那种不接，宁可留在搜索那一页（q= 实测出得来卡片），不把片名链接指向一个空壳。 */
export function iqAlbumUrl(a) {
  const u = String((a || {}).pageUrl || '').replace(/^http:/, 'https:');
  return /^https:\/\/www\.iqiyi\.com\/a_[0-9a-z]+\.html$/.test(u) ? u : '';
}
/* releaseTime 只有两种形状：'2026-11-05'（排上了）和 '2026'（没排上，整池 92 条里 87 条是这一种）。
   只给年份的一律不算档期 —— 当真就会印出「2026 年开播」那种废话。
   ⚠ 传 today 才挡已经过去的日期（《夺金战》那一类：标还挂在「即将上线」，日期是一个月前）。 */
export function iqReleaseDate(a, today) {
  const v = String(((a || {}).releaseTime || {}).value || '');
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v)) return null;
  if (today && v < today) return null;
  return v;
}
// '本周四18:00上线' → '18:00'；没给就 null，不猜一个 00:00 上去。
export const iqTimeText = a => (String((a || {}).startUpdateTime || '').match(/(\d{1,2}:\d{2})/) || [])[1] || null;

/* 考古：B 路 GET mesh.if.iqiyi.com/portal/lw/videolib/data 是 10-25 接上的那一路，要一枚 device_id。
   它回 200、回 301 字节、code:0，但整份回话里没有 data 这个键，只有 extData.dataExtRisk.risk_level:2
   加一枚 dataExtVerify.token —— 那是它自己那套 H5 运行时才签得出的东西，我们这边造不出来，也不该造。
   空 device_id、现场编的、他那枚真的、去掉 referer、换手机 UA、换版本串：六组回的是逐字节一样的空壳
   ⇒ 挡人的不是凭据。10-27 起线上 0 次回话；11-02 拿 90 秒一发的节拍连敲 8 发（19:57:47→20:08:18）全空壳
   ⇒ 早先记的「分钟级窗口」也证伪了。所以这一路整段摘掉，device_id 和那个 Secret 一起不要了。 */

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
export function diff(prev, items, livePlatforms, known, skipOut) {
  const now = new Map(items.map(x => [x.id, x]));
  const before = new Map((prev || []).filter(x => now.has(x.id) || livePlatforms.has(x.platform)).map(x => [x.id, x]));
  const scheduled = [], rescheduled = [], dateGone = [], newIn = [], out = [];
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
    /* 「档期消失」：条目还在池里，上一拍有日期、这一拍读不出来了。11-05 撞上的就是这一支 ——
       优酷开播当天把「11月5日上线」改成「今天上线」，我们认不出那句话，日期被静默擦掉，
       而事件流里一条痕迹都没有，看的人只能自己发现「优酷那一栏空了」。
       ⚠ 说法用中性的一句「不再给日期」，不写「取消定档」：这一支分不清是平台真撤了档，
         还是它换了个我们暂时读不懂的说法（后者占比目前是 1/1，就是今天这一条）。
         撤档这件事要能单独成立，得先有「平台自己写了撤档」的样本，现在没有。
       ⚠ 只认「还在池里」的那些条：整条不在池里了走下面 out 那一支，那一行本来就带着旧日期。 */
    else if (b.date && !x.date)
      dateGone.push({ ...brief(x), from: b.date });
  }
  /* skipOut：我们自己不收的那一类（芒果那一路的电影、动漫）不算「平台把它撤了」。
     不传就是老行为，一家都不漏 —— 这一条只挡「剔得对但记成撤档」那一种假新闻。 */
  for (const b of before.values()) if (!now.has(b.id) && !(skipOut && skipOut.has(b.id))) out.push(brief(b));
  const by = a => a.sort((x, y) => (x.platform + x.title).localeCompare(y.platform + y.title, 'zh'));
  return { scheduled: by(scheduled), rescheduled: by(rescheduled), dateGone: by(dateGone),
    newIn: by(newIn), out: by(out) };
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
  /* (a || []) 不是摆设：11-05 之前落盘的日格里没有 dateGone 这个键，而今天这一格恰好就是
     「旧形状的 cur + 新一拍的 fresh」那种合并 —— 少这一层兜底，下一拍整轮抛在这里。 */
  const keep = (a, b) => { const m = new Map((a || []).map(x => [x.key || x.id, x]));
    for (const x of (b || [])) if (!m.has(x.key || x.id)) m.set(x.key || x.id, x); return [...m.values()]; };
  return { ...cur, at, counts,
    scheduled: keep(cur.scheduled, fresh.scheduled),
    rescheduled: keep(cur.rescheduled, fresh.rescheduled),
    dateGone: keep(cur.dateGone, fresh.dateGone),
    newIn: keep(cur.newIn, fresh.newIn),
    out: keep(cur.out, fresh.out) };
}

export async function collectAll(prevItems, prevOff) {
  const one = async (k, fn) => { try { return [k, await fn()]; } catch (e) { return [k, { ok: false, msg: k + ' 取数异常：' + e.message }]; } };
  const rs = await Promise.all([one('qq', () => fetchQQ(prevItems)), one('yk', () => fetchYK(prevItems)), one('mg', () => fetchMG(prevItems, prevOff)), one('iq', fetchIQ)]);
  return Object.fromEntries(rs);
}

export function build(prevDoc, results, at) {
  const prevItems = Array.isArray(prevDoc && prevDoc.items) ? prevDoc.items : [];
  /* 芒果按类型剔掉的那几条不在 items 里 —— 在 diff 眼里就成了「今天从池子里没了」，
     看的人以为芒果把这些片撤了，其实是我们自己不收电视剧以外的。所以 diff 拿这份备忘当凭据，
     被它剔掉的不记「出池」。取数失败那一拍沿用上一份，和「一家没取到不许清池」是同一条规矩。 */
  const mgOff = results.mg && results.mg.ok ? (results.mg.off || {})
    : Object.assign({}, prevDoc && prevDoc.mgOff);
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
  /* 爱奇艺的开播日期是单独那一路（D 路）给的，整池条目却是另一路给的 —— 两路会各活各的。
     10-26 08:30 那一拍就是撞在这个上面：94 条照常回来、预约数照常带上，只有档期那一路没说话，
     于是「已排档期」从 2 部掉到 1 部，看的人以为《谜林》撤档了，其实是取数的手抖了一下。
     规则按「这一轮有没有问到这一条」来分，不按整家分：
       · 档期那一路整条没回话，或者回话里没点到这一条 ⇒ 上一轮已知的日期原样留着（没问过 ≠ 没有）；
       · 档期那一路点到了这一条、却没给日期       ⇒ 那才是真没排上档期，照实清空。
     代价：片方悄悄把已公布的档期撤掉、而那一轮又恰好没回话时，这里会继续挂着旧日期 ——
     但那种情况本来就没有可信的信号，宁可留着并记一行警告，也不要让它凭空消失。 */
  const iqR = results.iq;
  /* 档期那一路最后一次回话的时刻 —— 每一拍都往档案里带一份，接不上的那些拍好让页面有个时刻可报。
     第一拍没有这个字段，所以「本次没回话」那一档先老实说没记上，等下一次接上就自己长出来了。 */
  let iqOkAt = (prevDoc && prevDoc.iqOkAt) || null;
  if (iqR && iqR.ok && live.has('iq')) {
    const spoken = iqR.spoken instanceof Set ? iqR.spoken : null;
    if (spoken) iqOkAt = at;
    const prevIQ = new Map(prevItems.filter(x => x.platform === 'iq').map(x => [x.id, x]));
    /* 上一轮的 items 自己也可能已经被同一只手擦过一遍 —— 10-26 08:30 那一拍就是这个状态。
       那种时候唯一还留着这个日期的地方是事件行：days[] 里那条「新定档」自带 date。
       ⚠ 只在整路没回话时才翻它：回话点过名、却没给日期，那是真撤了档，翻出来就是假档期。
       ⚠ 只翻 scheduled/rescheduled 两类，11-05 新加的 dateGone 那一类**不进**这个表 ——
         它记的正是「这个日期已经不在了」，拿它当恢复源等于自己把擦掉的日期顶回去。
       残余的代价跟着变大一点：一条真撤掉的档期，如果在撤之后遇上一次没回话的拍，会被这行顶回来。 */
    const archive = new Map();
    if (!spoken) {
      for (const dy of (Array.isArray(prevDoc && prevDoc.days) ? prevDoc.days : []))
        for (const k of ['scheduled', 'rescheduled'])
          for (const r of (dy[k] || [])) if (r && r.date) archive.set(r.id, r);
    }
    for (const x of live.get('iq')) {
      if (x.date || (spoken && spoken.has(x.id))) continue;
      const p = prevIQ.get(x.id);
      const from = p && p.date ? p : archive.get(x.id);
      if (from && from.date) {
        x.date = from.date; x.time = from.time || null; x.dateText = from.dateText || from.date;
        if (!x.line && from.line) x.line = from.line;
      }
    }
    /* 类型和片名链接是同一发 D 路顺手带的（11-03 接上），所以那一条「问过没问过 ≠ 没有」的规矩
       一样管它们：这一拍没对上的条，上一轮认出来的类型、已经换成的专辑页地址不许被擦回去。
       11-03 同一张池子连着量两次：一次对上 97/99、一次只对上 80/99（它按片名搜，本身会抖）——
       拿「这一拍没问到」去擦上一拍问到的，看的人就会见着类型那一格隔一拍空一片。
       ⚠ 只在没对上时沿用：对上了却仍然没给类型，那才是真没有，照实空着（和日期那一支同一个判据）。 */
    for (const x of live.get('iq')) {
      const p = prevIQ.get(x.id);
      if (!p || (spoken && spoken.has(x.id))) continue;
      if (!x.genre && p.genre) x.genre = p.genre;
      // 上一轮换到的真专辑页留着；这一拍只剩站内搜索那条兜底，说明它没搜到这一条，不是爱奇艺改了口
      if (/\/search\?q=/.test(String(x.url || '')) && /^https:\/\/www\.iqiyi\.com\/a_[0-9a-z]+\.html$/.test(String(p.url || '')))
        x.url = p.url;
    }
    /* 这一行报的是那一路的通不通，不是「沿用了旧档期的有几部」—— 后者是缺席，看的人查不到。
       ⚠ 池子里一部都没排上档期的那些拍，旧那句「本次没有获取排播日期」压根不印（它挂在沿用条数上），
       现在改成只要这一路没回话就印 ⇒ 池子空着的时候这一行也在，那是它该有的样子。 */
    if (!spoken) warnings.push({ platform: 'iq', field: 'date',
      msg: iqOkAt ? `爱奇艺档期这一路最后一次回话 · ${iqOkAt}` : '爱奇艺档期这一路本次没回话' });
  }
  const kept = prevItems.filter(x => !live.has(x.platform));
  // 取到的覆盖同平台的旧条目，没取到的把旧条目留着（并记一条警告）。
  const items = [...kept, ...[...live.values()].flat()];
  /* 主演那一栏的占位词在这一处统一洗掉（他 11-03 点的：没标就不写，不要印「未知」）。
     写在 build 而不是四家各自的取数里，和上面那个 pos 同一本账 —— 四家各有各的返回路径，
     漏一家就少一家，而这一处保证不漏，连「这一家今天没取到、旧条目原样留着」那几条也一起洗。
     ⚠ 只动 cast：castOk 一个都不许改，那是「这扇门问过了」的凭据，抹了它等于每拍替平台重敲一次门。 */
  for (const x of items) x.cast = noUnknown(x.cast);
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
       ⚠ 代价（11-05 更新过一次，还是留着）：一部片子撤档之后又定回同一个日期，这一版认不出来。
       11-05 给 diff 补上了「档期消失」那一支，但**故意没让它反过来销掉 known** ——
       因为那一支分不清「平台真撤了」和「它换了个我们暂时读不懂的说法」，而后者今天就是现场那一条：
       优酷开播当天写「今天上线」，那一拍我们的解析还没接上，items 里的日期就成了 null。
       拿它去销 known 的后果是：下一拍认出来了，同一部片同一个日期又被记一遍「新定档」，
       正是 10-26 那次要堵掉的「两格里都是它，看的人以为又定了一次档」。
       真撤档要能单独成立，得先攒到一条「平台自己写了撤档/改期到别的一天」的样本，现在一条都没有。 */
    const known = new Map();
    for (const dy of days) for (const k of ['scheduled', 'rescheduled']) for (const r of (dy[k] || [])) {
      const s = (known.get(r.id) || new Set()).add(r.date || r.to);
      known.set(r.id, s);
    }
    const d = diff(prevItems, sorted, new Set(live.keys()), known, new Set(Object.keys(mgOff)));
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
    iqOkAt,
    platforms: PLATFORMS,
    warnings,
    days,
    mgOff,
    items: sorted,
  };
  return doc;
}

async function main() {
  const at = bjStamp(new Date());
  let prevDoc = null;
  if (fs.existsSync(OUT)) { try { prevDoc = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { prevDoc = null; } }
  const results = await collectAll(prevDoc && prevDoc.items, prevDoc && prevDoc.mgOff);
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
  if (last && !doc.baseline) console.log(`${last.day} 累计：新定档 ${last.scheduled.length} / 改档 ${last.rescheduled.length}`
    + ` / 档期消失 ${last.dateGone.length} / 进池 ${last.newIn.length} / 出池 ${last.out.length}`);
  else console.log('第一份档案：没有上一轮可比，diff 留空属正常');
  const dead = doc.warnings.filter(w => !w.field);
  if (dead.length) console.log('⚠ 这一轮有家没取到：' + dead.map(w => PLATFORMS[w.platform].name).join('、'));
  doc.warnings.filter(w => w.field).forEach(w => console.log('⚠ ' + w.msg));
  if (PROBE) { console.log('PROBE：不写文件'); return; }
  /* 每一轮都写：at 这个字段本身就是页面顶部「最后一次更新」那一行的全部内容，
     它不动，看的人就没法区分「今天一条新闻都没有」和「链路断了」。
     待播池定点一天四拍（08:30 / 12:30 / 16:30 / 20:30 北京，11-02 从两拍抬上来的），
     再算上工作流自己那个备份闹钟两拍（它没按事件名设门禁，迟到那一发照样采、照样提交）= 一天 6 轮：
     固定 120 个请求/拍、720 个/天，加上逐条那笔浮动最多 48 个/拍。
     大头是爱奇艺档期那 92 发 —— 那个口按片名搜、没有批量口，一条一发，数目跟着池子走。 */
  fs.writeFileSync(OUT, JSON.stringify(doc) + '\n', 'utf8');
  console.log(`写了 ${OUT}（${doc.items.length} 条 · ${doc.days.length} 天 diff）`);
}

// 校验脚本要 import 这里面的纯函数，所以「直接跑」得认得出自己是命令行那一发。
if (process.argv[1] && /fetch_paibo\.mjs$/.test(process.argv[1].replace(/\\/g, '/'))) {
  main().catch(e => { console.error('跑了但炸了：', e.message); process.exit(1); });
}
