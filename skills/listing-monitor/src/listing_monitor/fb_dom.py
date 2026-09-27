"""JS для чтения постов групп Facebook — одна копия на все способы запуска.

Сбор постов возможен двумя путями: локальный Chrome через мост browser-scout и
удалённый Chrome на хосте с сессией (playwright по CDP). Вёрстка Facebook у них
одна и меняется у обоих одновременно, поэтому селекторы живут здесь, а не в
каждом скрипте отдельно — иначе после очередной правки один путь чинят, а
второй тихо отдаёт мусор.
"""
from __future__ import annotations

# Facebook сворачивает длинный пост кнопкой «See more», а цену вьетнамцы пишут
# в конце. Без раскрытия 23 поста из 31 уходили в отсев «нет цены» (27.09.2026).
EXPAND = (
    "(function(){var c=0;"
    "[].slice.call(document.querySelectorAll('div[role=\"button\"],span[role=\"button\"]'))"
    ".forEach(function(b){var t=(b.innerText||'').trim();"
    "if(t==='See more'||t==='Xem thêm'||t==='Ещё'){try{b.click();c++}catch(e){}}});"
    "return c})()"
)

# Из карточки поста: текст, автор, время и ссылка на сам пост.
GRAB = """
[].slice.call(document.querySelectorAll('[data-ad-rendering-role="story_message"]'))
  .map(function(m){
    var card = m.closest('div[role="article"]') || m.parentElement;
    // Permalink у метки времени Facebook вырезает — остаётся href="?__cft__[0]=...".
    // Зато ссылка на фото поста живая и ведёт к тому же посту
    // («This photo is from a post → View Post»).
    var photo = card ? card.querySelector('a[href*="/photo/?fbid="]') : null;
    var href = photo ? photo.getAttribute('href').split('&__cft__')[0] : '';
    var who = card ? card.querySelector('h2 a, h3 a, strong a') : null;
    var t = card ? card.querySelector('abbr, a[href*="__cft__"] span') : null;
    return {
      text: (m.innerText||'').replace(/\\s+/g,' ').trim().slice(0,1500),
      url: href,
      author: who ? (who.innerText||'').trim().slice(0,60) : '',
      time: t ? (t.innerText||'').trim().slice(0,30) : ''
    };
  }).filter(function(x){return x.text.length > 30}).slice(0, LIMIT)
"""

SEARCH_URL = "https://www.facebook.com/groups/{group}/search/?q={query}"

# Facebook отвечает этим, когда в браузере активна Страница, а не личный профиль.
PAGE_PROFILE_ERROR = ('Facebook отвечает "Pages can\'t use Marketplace" — '
                      'в браузере активна Страница, нужен личный профиль')


def grab(limit: int) -> str:
    return GRAB.replace('LIMIT', str(int(limit)))
