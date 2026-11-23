"""Release identity and self-contained notices, applied after upstream localization."""
import re
from html import escape
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NAME = 'JIZURA Layer Studio'


def read(name):
    return (ROOT / name).read_text(encoding='utf-8')


def body(source, lang, version):
    ja = lang == 'ja'
    guide_label = '利用ガイド' if ja else 'User guide'
    heading = '利用について' if ja else 'About / rights'
    intro = ('本アプリは、hakoniwa氏の「JIZURA」を基に、cityedgeが字幕レイヤー制作向けに改変した非公式派生版です。さらにPosn973が、Firefoxでの書き出し対応・AAC音声のそのままコピー・背景に合わせた画面比などを加えた版（Firefox Compatible）です。原版の作者・cityedgeが本版の開発・保守を担当するものではありません。' if ja else
             'This is an unofficial derivative of JIZURA by hakoniwa, adapted by cityedge for subtitle layer production. Posn973 further modified it (Firefox Compatible: Firefox export, AAC audio copy, background-matched aspect ratio). Neither the original author nor cityedge maintains this edition.')
    rights = ('出力動画に本アプリのライセンス（GPL）はかからず、ライセンス表示を動画へ付ける必要もありません。歌詞・音楽・画像・動画・フォントなど、使用する素材の権利と利用条件は個別に確認してください。' if ja else
              'Exported videos are not covered by this app’s license (GPL), and you do not need to place a license notice in them. Check the rights and terms of the lyrics, music, images, videos, fonts and other material you use.')
    privacy = ('選択した素材はブラウザ内で処理し、アプリからサーバーへ送信しません。設定と字幕はブラウザの保存領域に自動保存します。フォント取得時にはGoogle Fontsへ接続します。素材ファイルはプロジェクトJSONに含みません。' if ja else
               'Selected media is processed in your browser and is not uploaded by the app. Settings and subtitles are autosaved in browser storage. Font loading connects to Google Fonts. Media files are not embedded in project JSON.')
    terms = f'''<dialog id="termsDlg" class="terms publication-dialog" aria-labelledby="termsTitle">
  <form method="dialog">
    <h2 id="termsTitle" tabindex="-1">{heading}</h2>
    <div class="terms-main"><p class="terms-big">{NAME}</p><p>Firefox Compatible (Posn973) · cityedge fork · v{escape(version)}</p></div>
    <p>{intro}</p>
    <p><a href="https://github.com/852wa/JIZURA" target="_blank" rel="noopener">{'原版 JIZURA — hakoniwa' if ja else 'Original JIZURA — hakoniwa'}</a></p>
    <p>{rights}</p>
    <p class="muted terms-note">{privacy}</p>
    <p>{'本派生版は MP4 書き出しに x264 を含むため、全体を GNU GPL v2 以降で配布します。原版と cityedge 版のコードは MIT ライセンスです。無保証で提供します。' if ja else 'Because MP4 export includes x264, this derivative as a whole is distributed under the GNU GPL v2 or later. The original and cityedge code is MIT licensed. Provided without warranty.'}</p>
    <details class="terms-oss"><summary>{'アプリのライセンス全文' if ja else 'Full application license'}</summary><pre class="license-text">{escape(read('LICENSE'))}</pre></details>
    <details class="terms-oss"><summary>{'使用しているオープンソース' if ja else 'Third-party software and fonts'}</summary><pre class="license-text">{escape(read('THIRD_PARTY_NOTICES.md'))}</pre></details>
    <details class="terms-oss"><summary>Mediabunny · MPL-2.0</summary><p><a href="https://registry.npmjs.org/mediabunny/-/mediabunny-1.60.0.tgz">{'使用版のソースコード（1.60.0）' if ja else 'Source code of the bundled version (1.60.0)'}</a></p><pre class="license-text">{escape(read('vendor/mediabunny.LICENSE.txt'))}</pre></details>
    <details class="terms-oss"><summary>x264 · GPL-2.0-or-later</summary><p><a href="https://github.com/Posn973/JIZURA-Layer-Studio-Firefox-Compatible/tree/main/vendor/x264" target="_blank" rel="noopener">{'使用版のソースコード・変更点・ビルド手順（vendor/x264）' if ja else 'Source code, changes and build steps of the bundled version (vendor/x264)'}</a></p><pre class="license-text">{escape(read('COPYING'))}</pre></details>
    <p><button type="button" class="guide-open">{guide_label}</button></p>
    <div class="terms-foot"><span class="muted">Original © 2026 hakoniwa<br>Modifications © 2026 cityedge<br>Modifications © 2026 Posn973 · GPL-2.0-or-later</span><button value="close" class="primary" autofocus>{'閉じる' if ja else 'Close'}</button></div>
  </form>
</dialog>'''
    source, count = re.subn(r'<dialog id="termsDlg".*?</dialog>', lambda _: terms, source, count=1, flags=re.S)
    if count != 1:
        raise ValueError('About dialog not found')
    source = source.replace('<!-- PUBLICATION_GUIDE_BUTTON -->', f'<button id="btnGuide" type="button" class="ghost guide-open">{guide_label}</button>', 1)
    return source + '\n' + read('app/guide.ja.html' if ja else 'app/guide.en.html').replace('@VERSION@', escape(version))
