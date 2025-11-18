// ==UserScript==
// @name            YouTube Shadow Comment
// @description     Checks if your comments are visible to the public
// @version         20251118-0
// @author          Robert Wesner (https://robert.wesner.io)
// @license         MIT
// @namespace       http://robert.wesner.io/
// @match           https://*.youtube.com/*
// @icon            https://scripts.yt/favicon.ico
// @grant           none
// @downloadURL     https://raw.githubusercontent.com/RobertWesner/YouTube-Shadow-Comment/main/script.user.js
// @updateURL       https://raw.githubusercontent.com/RobertWesner/YouTube-Shadow-Comment/main/script.user.js
// @homepageURL     https://scripts.yt/scripts/youtube-shadow-comment
// @supportURL      https://github.com/RobertWesner/YouTube-Shadow-Comment/issues
// ==/UserScript==

// ### INFORMATION FOR USERS AND YOUTUBE ###
//
// This is much more lightweight in terms of requests than opening a private window and checking this way.
// The hope exists, that YouTube will not be bothered by this minimal request, even if it operates in a possibly "reverse engineered" context.
// Though that context did not require any work besides opening the network tab.
// I have taken care to only send requests when necessary, with the consequences of those requests on YouTube's end considered.
// I could rework it to use iframes and localStorage but that leads to more performance problems on both the user's and YouTube's end.
//
// I deliberately chose that single endpoint (v1/next) instead of YouTube Data API,
// as to not have to process user information on my end.
// All data processed by this userscript stays within the YouTube context.
//
// It is very unlikely to get you, the user, personally in trouble, but the usual disclaimer applies.
// This is a third party script operating on a singular YouTube-internal endpoint in a non-bot, non-scraping way,
// but YouTube has every right to block access to that endpoint if they deem this script to be harmful.
//
// Anyone who is *really* concerned that this might get their account in trouble, should skip this, even if the chance for repercussions is negligible.

/**
 * @var {{ defaultPolicy: any, createPolicy: (string, Object) => void }} window.trustedTypes
 */

(() => {
    // TODO: rework the dynamic HTML to not require this bypass
    if (window.hasOwnProperty('trustedTypes') && !window.trustedTypes.defaultPolicy) {
        window.trustedTypes.createPolicy('default', { createHTML: string => string });
    }

    document.head.insertAdjacentHTML('beforeend', `<style>
        ytd-comment-view-model #body {
            padding: 1em;
            border-radius: 1em;
        }

        [data-ysc-invisible-comment="checking"] {
            background-color: rgba(100, 100, 100, 20%) !important;
        }

        [data-ysc-invisible-comment="checking"] #published-time-text::after {
            content: '\\00a0(Checking...)';
        }

        [data-ysc-invisible-comment="banned"] {
            background-color: rgba(255, 0, 0, 20%) !important;
        }

        [data-ysc-invisible-comment="valid"] {
            background-color: rgba(3, 255, 36, 20%) !important;
        }
    </style>`)

    // Both intervals should be infrequent enough and have proper guards inside to prevent performance issues.
    // Listening to navigation events or similar is unreliable as you also need to listen for comment scrolling.
    setInterval(() => {
        if (window.location.pathname !== '/watch') {
            return;
        }

        if (!document.querySelector('.ytd-comment-simplebox-renderer img#img')) {
            return;
        }

        if (document.body.hasAttribute('data-ysc-loaded')) {
            return;
        }
        document.body.setAttribute('data-ysc-loaded', 'loaded');

        let waitForCleanup = false;
        document.querySelectorAll('#sort-menu tp-yt-paper-item').forEach(
            element => element.addEventListener('click', () => {
                waitForCleanup = true;
                document.querySelectorAll('[data-ysc-invisible-comment]')
                    .forEach(element => element.removeAttribute('data-ysc-invisible-comment'));
                setTimeout(() => waitForCleanup = false, 2000);
            })
        );

        fetch('https://www.youtube.com/playlist?list=LL').then(r => r.text()).then(html => {
            let searchQuery = `#author-text[href="/${html.match(/ownerEndpoint.*?"url":"\/(@[\w-_.]+)","webPageType":"WEB_PAGE_TYPE_CHANNEL"/)[1]}"]`

            setInterval(() => {
                if (!window.location.pathname.endsWith('/watch')) {
                    return;
                }

                if (waitForCleanup) {
                    return;
                }

                document.querySelectorAll(searchQuery).forEach(element => {
                    const parent = element.parentNode.parentNode.parentNode.parentNode.parentNode;
                    if (parent.hasAttribute('data-ysc-invisible-comment')) {
                        return;
                    }

                    const commentLink = parent.querySelector('#published-time-text a').href;
                    parent.setAttribute('data-ysc-invisible-comment', 'checking');

                    fetch(commentLink)
                        .then(response => response.text())
                        .then(text => {
                            const pos = text.search('"continuationCommand"');
                            const continuationCommand = text.substring(pos + 32, text.indexOf('"', pos + 32));

                            fetch('https://www.youtube.com/youtubei/v1/next?prettyPrint=false', {
                                method: 'POST',
                                body: JSON.stringify({
                                    context: {
                                        client: {
                                            clientName: 'WEB',
                                            clientVersion: '2.20240411.09.00'
                                        }
                                    },
                                    continuation: continuationCommand,
                                })
                            })
                                .then(response => response.json())
                                .then(json => {
                                    const { payload } = json?.frameworkUpdates?.entityBatchUpdate?.mutations?.filter(element =>
                                        element?.payload?.commentEntityPayload?.properties?.commentId === new URLSearchParams(commentLink).get('lc')
                                    )?.[0] ?? { payload: null };

                                    // checks if first fetched comment matches highlighted comment, i.e. comment is visible publicly
                                    parent.setAttribute(
                                        'data-ysc-invisible-comment',
                                        !!payload
                                            ? 'valid'
                                            : 'banned'
                                    );
                                });
                        });
                });
            }, 2000);
        });
    }, 1000);
})();
