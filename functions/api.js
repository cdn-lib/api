const express = require('express');
const cors = require('cors');
const os = require('os');
const axios = require('axios');
const https = require('https');
const { load } = require('cheerio');
const { execSync } = require('child_process');
const { getDownloadLink, getToken, getContent, getWt, listFiles } = require('gofile-downloader');
const serverless = require('serverless-http');
require('dotenv').config();

const app = express();
const BASEURL = process.env.BASEURL || 'https://otakudesu.best';
const ANOBOY = process.env.ANOBOY || 'https://anoboy.be';

const axiosInstance = axios.create({
    timeout: 15000,
    httpsAgent: new https.Agent({ keepAlive: true }),
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': `${BASEURL}/`
    }
});

const pagination = (html, anoboy = false) => {
    const $ = load(html);

    const current_page = anoboy
        ? parseInt($('.wp-pagenavi .current').text())
        : parseInt($('.pagination .pagenavix .page-numbers.current').text());

    const last_visible_page = anoboy
        ? parseInt($('.wp-pagenavi .page.larger:last').text())
        : parseInt($('.pagination .pagenavix .page-numbers:last').prev('a.page-numbers').text());

    const next_page = current_page < last_visible_page ? current_page + 1 : null;
    const previous_page = current_page > 1 ? current_page - 1 : null;
    const has_next_page = current_page < last_visible_page;
    const has_previous_page = current_page > 1;

    if (!current_page) return false;

    return {
        current_page,
        last_visible_page: current_page < last_visible_page ? last_visible_page : current_page,
        has_next_page,
        next_page,
        has_previous_page,
        previous_page
    };
};

const mapGenres = (html) => {
    const result = [];
    const genres = html.split('</a>')
        .filter(item => item.trim() !== '')
        .map(item => `${item}</a>`);

    genres.forEach(genre => {
        const $ = load(genre);
        result.push({
            name: $('a').text(),
            slug: $('a').attr('href')
                ?.replace(/^https:\/\/otakudesu\.[a-zA-Z0-9-]+\/genres\//, '')
                .replace('/', ''),
            otakudesu_url: $('a').attr('href')
        });
    });

    return result;
};

const getBatch = (html) => {
    const $ = load(html);
    const batch = $('.venser #serieslist ~ .episodelist ul li:first-child span:first-child a').attr('href');
    const uploaded_at = $('.venser #serieslist ~ .episodelist ul li:first-child span.zeebr:first').text();

    return batch?.match('episode') ? null : {
        slug: batch
            ?.replace(/^https:\/\/otakudesu\.[a-zA-Z0-9-]+\/batch\//, '')
            .replace('/', ''),
        otakudesu_url: batch,
        uploaded_at
    };
};

const scrapeOngoingAnime = (html) => {
    const result = [];
    const animes = html
        .split('</li>')
        .filter(item => item.trim() !== '')
        .map(item => `${item}</li>`);

    animes.forEach(anime => {
        const $ = load(anime);
        result.push({
            title: $('.detpost .thumb .thumbz .jdlflm').text(),
            slug: $('.detpost .thumb a')
                .attr('href')
                ?.replace(/^https:\/\/otakudesu\.[a-zA-Z0-9-]+\/anime\//, '')
                .replace('/', ''),
            poster: $('.detpost .thumb .thumbz img').attr('src'),
            current_episode: $('.detpost .epz').text().trim(),
            release_day: $('.detpost .epztipe').text().trim(),
            newest_release_date: $('.detpost .newnime').text(),
            otakudesu_url: $('.detpost .thumb a').attr('href')
        });
    });

    return result;
};

const scrapeCompleteAnime = (html) => {
    const result = [];

    const animes = html
        .split('</li>')
        .filter(item => item.trim() !== '')
        .map(item => `${item}</li>`);

    animes.forEach(anime => {
        const $ = load(anime);
        result.push({
            title: $('.detpost .thumb .thumbz .jdlflm').text(),
            slug: $('.detpost .thumb a')
                .attr('href')
                ?.replace(/^https:\/\/otakudesu\.[a-zA-Z0-9-]+\/anime\//, '')
                .replace('/', ''),
            poster: $('.detpost .thumb .thumbz img').attr('src'),
            episode_count: $('.detpost .epz')
                .text()
                .trim()
                .replace(' Episode', ''),
            rating: $('.detpost .epztipe').text().trim(),
            last_release_date: $('.detpost .newnime').text(),
            otakudesu_url: $('.detpost .thumb a').attr('href')
        });
    });

    return result;
};

const scrapeAnimeEpisodes = (html) => {
    const result = [];
    let $ = load(html);

    $ = load(`<div>${$('.episodelist').toString()}</div>`);

    const episodeList = $('.episodelist:nth-child(2) ul')
        .html()
        ?.split('</li>')
        .filter(item => item.trim() !== '')
        .map(item => `${item}</li>`);

    if (!episodeList) return undefined;

    for (const episode of episodeList) {
        const $$ = load(episode);
        result.unshift({
            episode: $$('li span:first a').text(),
            slug: $$('li span:first a')
                .attr('href')
                ?.replace(/^https:\/\/otakudesu\.[a-zA-Z0-9-]+\/episode\//, '')
                .replace('/', ''),
            otakudesu_url: $$('li span:first a').attr('href')
        });
    }

    return result;
};

const scrapeGenreLists = (html) => {
    const $ = load(html);
    const result = [];

    const genres = $('#venkonten .vezone ul.genres li a')
        .toString()
        .split('</a>')
        .filter((el) => el.trim() !== '')
        .map((el) => `${el}</a>`);

    genres.forEach((genre) => {
        const $$ = load(genre);
        const href = $$('a').attr('href');

        result.push({
            name: $$('a').text(),
            slug: href?.replace('/genres/', '').replace('/', ''),
            otakudesu_url: href ? `${BASEURL}${href}` : null
        });
    });

    return result;
};

const scrapeAnimeByGenre = (html) => {
    const $ = load(html);
    const animeElements = $('.venser .page .col-anime-con')
        .toString()
        .split('<div class="col-md-4 col-anime-con genre_2 genre_3 genre_4 genre_9 ">')
        .filter((element) => element.trim() !== '')
        .map((element) => `<div class="col-md-4 col-anime-con genre_2 genre_3 genre_4 genre_9 ">${element}`);

    const result = [];

    animeElements.forEach((animeEl) => {
        const $ = load(animeEl);
        const episodeCount = $('.col-anime .col-anime-eps').text().replace(/[A-Za-z]/g, '').trim();
        const genres = mapGenres($('.col-anime .col-anime-genre a').toString());

        result.push({
            title: $('.col-anime .col-anime-title a').text(),
            slug: $('.col-anime .col-anime-trailer a').attr('href')
                ?.replace(/^https:\/\/otakudesu\.[a-zA-Z0-9-]+\/anime\//, '')
                .replace('/', ''),
            poster: $('.col-anime .col-anime-cover img').attr('src'),
            rating: $('.col-anime .col-anime-rating').text() || null,
            episode_count: episodeCount === '' ? null : episodeCount,
            season: $('.col-anime .col-anime-date').text(),
            studio: $('.col-anime .col-anime-studio').text(),
            genres,
            synopsis: $('.col-anime .col-synopsis p').text(),
            otakudesu_url: $('.col-anime .col-anime-trailer a').attr('href')
        });
    });

    return {
        anime: result,
        pagination: pagination(html)
    };
};

const scrapeBatch = (html) => {
    const $ = load(html);
    const batch = $('.download2 .batchlink h4').text();

    const urlGroups = $('.download2 .batchlink ul li')
        .toString()
        .split('</li>')
        .filter((item) => item.trim() !== '')
        .map((item) => `${item}<li>`);

    const download_urls = [];

    urlGroups.forEach((urlGroup) => {
        const $$ = load(urlGroup);

        const providers = $$('a')
            .toString()
            .split('</a>')
            .filter((item) => item.trim() !== '')
            .map((item) => `${item}</a>`);

        const urls = providers.map((provider) => {
            const $$$ = load(provider);
            return {
                provider: $$$('a').text(),
                url: $$$('a').attr('href')
            };
        });

        download_urls.push({
            resolution: $$('li strong').text().replace(/([A-Za-z]{2}[0-9]\s)/, ''),
            file_size: $$('li i').text(),
            urls
        });
    });

    return {
        batch,
        download_urls
    };
};

const scrapeSearchResult = (html) => {
    const $ = load(html);
    const searchResult = [];

    $('.chivsrc li').each((i, el) => {
        const titleTag = $(el).find('h2 a');
        const title = titleTag.text().trim();
        const url = titleTag.attr('href');

        if (!title || !url) return;

        const slug = url
            .replace(/^https:\/\/otakudesu\.[a-zA-Z0-9-]+\/anime\//, '')
            .replace('/', '');

        const poster = $(el).find('img').attr('src');

        let genres = [];
        let status = 'Unknown';
        let rating = 'N/A';

        $(el).find('.set').each((j, setEl) => {
            const text = $(setEl).text();
            const htmlContent = $(setEl).html();

            if (text.includes('Genres')) {
                const cleanHtml = htmlContent
                    .replace('<b>Genres</b>', '')
                    .replace(':', '')
                    .trim();
                genres = mapGenres(cleanHtml);
            } else if (text.includes('Status')) {
                status = text.replace('Status', '').replace(':', '').trim();
            } else if (text.includes('Rating')) {
                rating = text.replace('Rating', '').replace(':', '').trim();
            }
        });

        searchResult.push({
            title,
            slug,
            poster,
            genres,
            status,
            rating,
            url
        });
    });

    return searchResult;
};

const getSynopsis = (html) => {
    const $ = load(html);
    const text = $('.sinopc').html() || '';
    return text
        .replace(/<\/?p>/g, '\n')
        .replace(/&nbsp;/g, ' ')
        .trim();
};

const getPoster = (html) => {
    const $ = load(html);
    return $('.fotoanime img').attr('src');
};

const getRecommendations = (html) => {
    const result = [];
    const animeEls = html
        .split('</div></div></div>')
        .filter(el => el.trim() !== '')
        .map(el => `${el}</div></div></div>`);

    animeEls.forEach((el) => {
        const $$ = load(el);
        const otakudesu_url = $$('a').attr('href');
        const slug = otakudesu_url?.replace(/^https:\/\/otakudesu\.[a-zA-Z0-9-]+\/anime\//, '').replace('/', '');

        result.push({
            title: $$('.judul-anime').text().trim(),
            slug,
            poster: $$('.isi-anime img').attr('src'),
            otakudesu_url
        });
    });

    return result;
};

const createAnimeData = (html, poster, synopsis, episode_lists) => {
    const $ = load(html);

    const title = $('.infozin .infozingle p:first span').text()?.replace('Judul: ', '');
    const japanese_title = $('.infozin .infozingle p:nth-child(2) span').text()?.replace('Japanese: ', '');
    const rating = $('.infozin .infozingle p:nth-child(3) span').text()?.replace('Skor: ', '');
    const produser = $('.infozin .infozingle p:nth-child(4) span').text()?.replace('Produser: ', '');
    const type = $('.infozin .infozingle p:nth-child(5) span').text()?.replace('Tipe: ', '');
    const status = $('.infozin .infozingle p:nth-child(6) span').text()?.replace('Status: ', '');
    const episode_count = $('.infozin .infozingle p:nth-child(7) span').text()?.replace('Total Episode: ', '');
    const duration = $('.infozin .infozingle p:nth-child(8) span').text()?.replace('Durasi: ', '');
    const release_date = $('.infozin .infozingle p:nth-child(9) span').text()?.replace('Tanggal Rilis: ', '');
    const studio = $('.infozin .infozingle p:nth-child(10) span').text()?.replace('Studio: ', '');
    const genres = mapGenres($('.infozin .infozingle p:last span a').toString());
    const batch = getBatch(html);
    const recommendations = getRecommendations($('#recommend-anime-series .isi-recommend-anime-series .isi-konten').toString());

    if (!episode_lists) return undefined;

    return {
        title,
        japanese_title,
        poster,
        rating,
        produser,
        type,
        status,
        episode_count,
        duration,
        release_date,
        studio,
        genres,
        synopsis,
        batch,
        episode_lists,
        recommendations
    };
};

const scrapeSingleAnime = (html) => {
    return createAnimeData(
        html,
        getPoster(html),
        getSynopsis(html),
        scrapeAnimeEpisodes(html)
    );
};

const EXTERNAL_API_URL = 'https://anime-api-ebon-mu.vercel.app/api';

const parseM3u8Resolutions = async (masterUrl) => {
    try {
        const response = await axiosInstance.get(masterUrl);
        const content = response.data;
        const resolutions = {};

        if (!content.includes('RESOLUTION=')) return { "Auto": masterUrl };

        const lines = content.split('\n');
        lines.forEach((line, index) => {
            if (line.includes('RESOLUTION=')) {
                const resMatch = line.match(/RESOLUTION=\d+x(\d+)/);
                if (resMatch && resMatch[1]) {
                    const label = resMatch[1] + 'p';
                    const urlLine = lines[index + 1];
                    if (urlLine && !urlLine.startsWith('#')) {
                        resolutions[label] = urlLine;
                    }
                }
            }
        });

        resolutions['Auto'] = masterUrl;
        return resolutions;
    } catch (e) {
        return { "Default": masterUrl };
    }
};

const getExternalStream = async (title, episodeNumber) => {
    try {
        const searchRes = await axiosInstance.get(`${EXTERNAL_API_URL}/search`, {
            params: { keyword: title }
        });

        if (!searchRes.data.success || !searchRes.data.results.length) return {};
        const animeId = searchRes.data.results[0].id;

        const episodesRes = await axiosInstance.get(`${EXTERNAL_API_URL}/episodes/${animeId}`);
        if (!episodesRes.data.success) return {};

        const episodes = episodesRes.data.results.episodes;
        const targetEp = episodes.find(e => e.episode_no === episodeNumber);
        if (!targetEp) return {};

        const streamRes = await axiosInstance.get(`${EXTERNAL_API_URL}/stream`, {
            params: { id: targetEp.id }
        });

        if (!streamRes.data.success || !streamRes.data.results.streamingLink) return {};
        const hlsLink = streamRes.data.results.streamingLink.find(l => l.link.type === 'hls');

        if (hlsLink) {
            return await parseM3u8Resolutions(hlsLink.link.file);
        } else {
            const mp4Link = streamRes.data.results.streamingLink.find(l => l.link.type === 'mp4');
            if (mp4Link) return { "Default": mp4Link.link.file };
        }
        return {};

    } catch (error) {
        return {};
    }
};

const getLocalStreamQuality = async ($) => {
    const streamLable = $('.mirrorstream');
    const actions = [];

    $("script").each((i, el) => {
        const scriptContent = $(el).html();
        if (!scriptContent) return;
        const regex = /action\s*:\s*"([a-z0-9]+)"/gi;
        let match;
        while ((match = regex.exec(scriptContent)) !== null) {
            actions.push(match[1]);
        }
    });

    if (actions.length < 2) return {};

    const uniqueActions = [...new Set(actions)];
    const actionInitial = uniqueActions[1];
    const actionFinal = uniqueActions[0];

    const payloads = {};
    ["m360p", "m480p", "m720p"].forEach(q => {
        const items = streamLable.find(`ul.${q} li a`);
        let selected = items.filter((i, el) => {
            const txt = $(el).text().toLowerCase();
            return txt.includes("desu") || txt.includes("drain") || txt.includes("ondesu");
        }).first();

        if (!selected.length) selected = items.first();

        if (selected.length) {
            const dataContent = selected.attr("data-content");
            if (dataContent) {
                try {
                    const jsonPayload = JSON.parse(Buffer.from(dataContent, "base64").toString("utf8"));
                    payloads[q.replace('m', '')] = jsonPayload;
                } catch (e) {}
            }
        }
    });

    return await processAjaxPayloads(actionInitial, actionFinal, payloads);
};

const processAjaxPayloads = async (action1, action2, videoData) => {
    const tasks = Object.entries(videoData).map(async ([res, payload]) => {
        try {
            const url = `${BASEURL}/wp-admin/admin-ajax.php`;

            const form1 = new URLSearchParams();
            form1.append("id", payload.id);
            form1.append("i", payload.i);
            form1.append("q", payload.q);
            form1.append("action", action1);

            const res1 = await axiosInstance.post(url, form1.toString());
            const nonce = res1.data.data;

            const form2 = new URLSearchParams();
            form2.append("id", payload.id);
            form2.append("i", payload.i);
            form2.append("q", payload.q);
            form2.append("action", action2);
            form2.append("nonce", nonce);

            const res2 = await axiosInstance.post(url, form2.toString());
            const htmlString = Buffer.from(res2.data.data, "base64").toString("utf8");
            const $$ = load(htmlString);
            const iframeSrc = $$("iframe").attr("src");

            return [res, iframeSrc];
        } catch (err) {
            return null;
        }
    });

    const results = await Promise.all(tasks);
    return Object.fromEntries(results.filter(r => r !== null));
};

const getEpisodeTitle = ($) => $('.venutama .posttl').text();
const getStreamUrl = ($) => $('#pembed iframe').attr('src');

const createDownloadData = ($) => ({
    mp4: getDownloadLinks($, '.download ul:first li'),
    mkv: getDownloadLinks($, '.download ul:last li')
});

const getDownloadLinks = ($, selector) => {
    const result = [];
    $(selector).each((i, el) => {
        const urls = [];
        $(el).find('a').each((j, link) => {
            urls.push({
                provider: $(link).text(),
                url: $(link).attr('href'),
            });
        });
        result.push({
            resolution: $(el).find('strong').text()?.replace(/([A-z][A-z][0-9] )/, '').trim(),
            urls,
        });
    });
    return result;
};

const getPrevEpisode = ($) => {
    const href = $('.flir a:first').attr('href');
    return href?.includes('/episode/') ? href.match(/episode-(\d+)/)?.[1] : null;
};

const getNextEpisode = ($) => {
    const href = $('.flir a:last').attr('href');
    return href?.includes('/episode/') ? href.match(/episode-(\d+)/)?.[1] : null;
};

const getAnimeData = ($) => {
    let el = $('.flir a:nth-child(2)');
    if (!el.length || el.text().trim() === '') el = $('.flir a:first');
    return {
        slug: el.attr('href')?.replace(`${BASEURL}/anime/`, '')?.replace('/', ''),
        otakudesu_url: el.attr('href'),
    };
};

const scrapeEpisode = async (html) => {
    const $ = load(html);

    const episodeTitle = getEpisodeTitle($);
    const download_urls = createDownloadData($);
    const previous_episode = getPrevEpisode($);
    const next_episode = getNextEpisode($);
    const anime = getAnimeData($);
    const defaultStreamUrl = getStreamUrl($);

    if (!episodeTitle) return undefined;

    let streamResolutions = {};

    try {
        let cleanTitle = episodeTitle
            .replace(/Episode\s+\d+.*/i, '')
            .replace(/Subtitle Indonesia/i, '')
            .replace(/\s*Season\s*\d+/i, '')
            .replace(/\s*S\d+/i, '')
            .trim();

        const epMatch = episodeTitle.match(/Episode\s+(\d+)/i);
        const episodeNumber = epMatch ? parseInt(epMatch[1]) : 1;

        streamResolutions = await getExternalStream(cleanTitle, episodeNumber);
    } catch (err) {
    }

    if (!streamResolutions || Object.keys(streamResolutions).length === 0) {
        try {
            streamResolutions = await getLocalStreamQuality($);
        } catch (e) {
        }
    }

    if (streamResolutions) {
        Object.keys(streamResolutions).forEach(key => {
            const url = streamResolutions[key];
            if (!url || !url.includes('desustream.info')) {
                delete streamResolutions[key];
            }
        });
    }

    let validDefaultStream = null;
    if (defaultStreamUrl && defaultStreamUrl.includes('desustream.info')) {
        validDefaultStream = defaultStreamUrl;
    }

    if ((!streamResolutions || Object.keys(streamResolutions).length === 0) && validDefaultStream) {
        streamResolutions = { "Default": validDefaultStream };
    }

    return {
        episode: episodeTitle,
        anime,
        has_next_episode: !!next_episode,
        next_episode,
        has_previous_episode: !!previous_episode,
        previous_episode,
        stream_url: streamResolutions['480p'] || streamResolutions['Default'] || Object.values(streamResolutions)[0] || validDefaultStream,
        steramList: streamResolutions,
        download_urls,
    };
};

const homeFunc = async () => {
    const { data } = await axios.get(BASEURL, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            "Referer": `${BASEURL}/`,
        },
        timeout: 10000 
    });

    const $ = load(data);

    const ongoingAnimeEls = $('.venutama .rseries .rapi:first .venz ul li').toString();
    const completeAnimeEls = $('.venutama .rseries .rapi:last .venz ul li').toString();

    const ongoing_anime = scrapeOngoingAnime(ongoingAnimeEls);
    const complete_anime = scrapeCompleteAnime(completeAnimeEls);

    return { ongoing_anime, complete_anime };
};

const animeFunc = async (slug) => {
    const { data } = await axios.get(`${BASEURL}/anime/${slug}`, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        }
    });
    return scrapeSingleAnime(data);
};

const episodesFunc = async (slug) => {
    const { data } = await axios.get(`${BASEURL}/anime/${slug}`, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        }
    });

    return scrapeAnimeEpisodes(data);
};

const searchFunc = async (keyword) => {
    const url = `${BASEURL}/?s=${encodeURIComponent(keyword)}&post_type=anime`;

    const { data } = await axios.get(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            'Referer': `${BASEURL}/`
        },
        timeout: 12000
    });

    return scrapeSearchResult(data);
};

const ongoingAnimeFunc = async (page = 1) => {
    const url = `${BASEURL}/ongoing-anime/page/${page}`;

    const { data } = await axios.get(url, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            "Referer": `${BASEURL}/`
        },
        timeout: 12000
    });

    const $ = load(data);
    const ongoingAnimeEls = $('.venutama .rseries .rapi .venz ul li').toString();
    const ongoingAnimeData = scrapeOngoingAnime(ongoingAnimeEls);
    const paginationData = pagination($('.pagination').toString());

    return {
        paginationData,
        ongoingAnimeData
    };
};

const completeAnimeFunc = async (page = 1) => {
    const { data } = await axios.get(`${BASEURL}/complete-anime/page/${page}`, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        },
    });

    const $ = load(data);
    const completeAnimeEls = $('.venutama .rseries .rapi .venz ul li').toString();

    const completeAnimeData = scrapeCompleteAnime(completeAnimeEls);
    const paginationData = pagination($('.pagination').toString());

    return {
        paginationData,
        completeAnimeData
    };
};

const genreListsFunc = async () => {
    const { data } = await axios.get(`${BASEURL}/genre-list`, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            'Referer': `${BASEURL}/`,
        }
    });

    return scrapeGenreLists(data);
};

const animeByGenreFunc = async (genre, page = 1) => {
    const response = await axios.get(`${BASEURL}/genres/${genre}/page/${page}`, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        },
    });
    return scrapeAnimeByGenre(response.data);
};

const batchFunc = async ({ batchSlug, animeSlug }) => {
    let batch = batchSlug;

    if (animeSlug) {
        const response = await axios.get(`${BASEURL}/anime/${animeSlug}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            },
        });
        const batchData = getBatch(response.data);
        batch = batchData?.slug;
    }

    if (!batch) return false; 
    const response = await axios.get(`${BASEURL}/batch/${batch}`, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        },
    });

    return scrapeBatch(response.data);
};

const animeCache = new Map();
const CACHE_DURATION = 60 * 60 * 1000;

const episodeFunc = async ({ episodeSlug, animeSlug, episodeNumber }) => {
    let slug = '';

    if (episodeSlug) {
        slug = episodeSlug;
    }

    if (animeSlug) {
        let episodeLists;

        const cachedData = animeCache.get(animeSlug);
        const now = Date.now();

        if (cachedData && (now - cachedData.timestamp < CACHE_DURATION)) {
            episodeLists = cachedData.list;
        } else {
            episodeLists = await episodesFunc(animeSlug);

            if (episodeLists) {
                animeCache.set(animeSlug, {
                    list: episodeLists,
                    timestamp: now
                });
            }
        }

        if (!episodeLists) return undefined;

        const clean = episodeLists.map(ep => {
            const match = ep.episode.match(/Episode\s+(\d+)/i);
            return {
                ...ep,
                episode: match ? match[1] : null
            };
        });

        if (clean.length > 0) {
            const firstEp = clean[0].episode;
            const nextSlug = clean[1] ? clean[1].slug : clean[0].slug;
            const isFirst = firstEp === '0' && nextSlug.includes('-sub-indo-2');

            const split = clean[0].slug?.split('-episode-');
            const topPrefix = split?.[0] || animeSlug;

            const epNumPart = isFirst && episodeNumber == 1
                ? '1-sub-indo-2'
                : `${episodeNumber == 0 ? 1 : episodeNumber}-sub-indo`;

            slug = `${topPrefix}-episode-${epNumPart}`;
        }

    }

    try {
        const { data } = await axios.get(`${BASEURL}/episode/${slug}`, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                'Referer': `${BASEURL}/`,
            }
        });

        return await scrapeEpisode(data);

    } catch (error) {
        return undefined;
    }
};

const moviesFunc = async (page = 1) => {
    const movieUrl = `${ANOBOY}/category/anime-movie/page/${page}`;

    const { data } = await axios.get(movieUrl, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            "Referer": `${ANOBOY}/`
        },
        timeout: 12000
    });

    const $ = load(data);
    const movies = [];

    $('a[rel="bookmark"]').each((index, element) => {
        const $$ = load(element);
        const href = $$('a[rel="bookmark"]').attr('href');
        if (!href) return;

        const animex = href.replace(ANOBOY, '').split('/');

        movies.push({
            title: $$('a[rel="bookmark"]').attr('title') || null,
            years: animex[1] || null,
            month: animex[2] || null,
            slug: animex[3] || null,
            poster: ANOBOY + ($$('amp-img').attr('src') || ''),
            otakudesu_url: href
        });
    });

    return {
        movies,
        pagination: pagination($('.wp-pagenavi').toString(), true)
    };
};

const movieFunc = async (slug) => {
    const { data } = await axios.get(`${ANOBOY}${slug}`, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            'Referer': `${ANOBOY}/`,
        },
        timeout: 12000
    });

    const $ = load(data);
    
    const movie = {};
    movie.title = $('.unduhan h3').text().toLowerCase().split('sub')[0].trim();

    const posterPath = $('.unduhan amp-img').attr('src');
    movie.poster = posterPath ? ANOBOY + posterPath : null;
    const downloadUrls = {
        '480p': [],
        '720p': [],
        '1080p': []
    };

    $('.download .ud .udl').each((index, element) => {
        const $$ = load(element);
        const label = $$.text().trim().toLowerCase();
        const link = $$('a').attr('href');

        if (!link || link === 'none') return;


        if (label.includes('480')) {
            downloadUrls['480p'].push(link);
        } else if (label.includes('720')) {
            downloadUrls['720p'].push(link);
        } else if (label.includes('1080') || label.includes('1k')) {
            downloadUrls['1080p'].push(link);
        }
    });

    movie.download_urls = downloadUrls;
    movie.stream_url = downloadUrls['480p'].find(url => url.includes('mp4upload')) || null;

    return movie;
};

const searchAnimeHandler = async (req, res) => {
    const { keyword } = req.params;
    try {
        const data = await searchFunc(keyword);
        return res.status(200).json({ status: 'Ok', data });
    } catch (e) {
        return res.status(500).json({ status: 'Error', message: 'Internal server error' });
    }
};

const homeHandler = async (_, res) => {
    try {
        const data = await homeFunc();
        return res.status(200).json({ status: 'Ok', data });
    } catch (e) {
        return res.status(500).json({ status: 'Error', message: 'Internal server error' });
    }
};

const ongoingAnimeHandler = async (req, res) => {
    const { page } = req.params;

    if (page) {
        if (!parseInt(page)) return res.status(400).json({ status: 'Error', message: 'The page parameter must be a number!' });
        if (parseInt(page) < 1) return res.status(400).json({ status: 'Error', message: 'The page parameter must be greater than 0!' });
    }

    try {
        const result = page ? await ongoingAnimeFunc(parseInt(page)) : await ongoingAnimeFunc();
        const { paginationData, ongoingAnimeData } = result || {};

        if (!paginationData) return res.status(404).json({ status: 'Error', message: 'There\'s nothing here ;_;' });

        return res.status(200).json({ status: 'Ok', data: ongoingAnimeData, pagination: paginationData });
    } catch (e) {
        return res.status(500).json({ status: 'Error', message: 'Internal server error' });
    }
};

const completeAnimeHandler = async (req, res) => {
    const { page } = req.params;

    if (page) {
        if (!parseInt(page)) return res.status(400).json({ status: 'Error', message: 'The page parameter must be a number!' });
        if (parseInt(page) < 1) return res.status(400).json({ status: 'Error', message: 'The page parameter must be greater than 0!' });
    }

    try {
        const result = page ? await completeAnimeFunc(parseInt(page)) : await completeAnimeFunc();
        const { paginationData, completeAnimeData } = result || {};

        if (!paginationData) return res.status(404).json({ status: 'Error', message: 'There\'s nothing here ;_;' });

        return res.status(200).json({ status: 'Ok', data: completeAnimeData, pagination: paginationData });
    } catch (e) {
        return res.status(500).json({ status: 'Error', message: 'Internal server error' });
    }
};

const singleAnimeHandler = async (req, res) => {
    try {
        const data = await animeFunc(req.params.slug);
        if (!data) return res.status(404).json({ status: 'Error', message: 'There\'s nothing here ;_;' });

        return res.status(200).json({ status: 'Ok', data });
    } catch (e) {
        return res.status(500).json({ status: 'Error', message: 'Internal server error' });
    }
};

const episodesHandler = async (req, res) => {
    try {
        const data = await episodesFunc(req.params.slug);
        if (!data) return res.status(404).json({ status: 'Error', message: 'There\'s nothing here ;_;' });
        return res.status(200).json({ status: 'Ok', data });
    } catch (e) {
        return res.status(500).json({ status: 'Error', message: 'Internal server error' });
    }
};

const episodeByEpisodeSlugHandler = async (req, res) => {
    try {
        const data = await episodeFunc({ episodeSlug: req.params.slug });
        if (!data) return res.status(404).json({ status: 'Error', message: 'There\'s nothing here ;_;' });
        return res.status(200).json({ status: 'Ok', data });
    } catch (e) {
        return res.status(500).json({ status: 'Error', message: 'Internal server error' });
    }
};

const episodeByEpisodeNumberHandler = async (req, res) => {
    const { slug: animeSlug, episode } = req.params;
    try {
        const data = await episodeFunc({ animeSlug, episodeNumber: parseInt(episode) });
        if (!data) return res.status(404).json({ status: 'Error', message: 'There\'s nothing here ;_;' });
        return res.status(200).json({ status: 'Ok', data });
    } catch (e) {
        return res.status(500).json({ status: 'Error', message: 'Internal server error' });
    }
};

const batchByBatchSlugHandler = async (req, res) => {
    try {
        const data = await batchFunc({ batchSlug: req.params.slug });
        return res.status(200).json({ status: 'Ok', data });
    } catch (e) {
        return res.status(500).json({ status: 'Error', message: 'Internal server error' });
    }
};

const batchHandler = async (req, res) => {
    try {
        const data = await batchFunc({ animeSlug: req.params.slug });
        return data
            ? res.status(200).json({ status: 'Ok', data })
            : res.status(404).json({ status: 'Error', message: 'This anime doesn\'t have a batch yet ;_;' });
    } catch (e) {
        return res.status(500).json({ status: 'Error', message: 'Internal server error' });
    }
};

const genreListsHandler = async (_, res) => {
    try {
        const data = await genreListsFunc();
        return res.status(200).json({ status: 'Ok', data });
    } catch (e) {
        return res.status(500).json({ status: 'Error', message: 'Internal server error' });
    }
};

const animeByGenreHandler = async (req, res) => {
    const { slug, page } = req.params;
    if (page) {
        if (!parseInt(page)) return res.status(400).json({ status: 'Error', message: 'The page parameter must be a number!' });
        if (parseInt(page) < 1) return res.status(400).json({ status: 'Error', message: 'The page parameter must be greater than 0!' });
    }
    try {
        const data = await animeByGenreFunc(slug, page);
        return res.status(200).json({ status: 'Ok', data });
    } catch (e) {
        return res.status(500).json({ status: 'Error', message: 'Internal server error' });
    }
};

const moviesHandler = async (req, res) => {
    const { page } = req.params;
    if (page) {
        if (!parseInt(page)) return res.status(400).json({ status: 'Error', message: 'The page parameter must be a number!' });
        if (parseInt(page) < 1) return res.status(400).json({ status: 'Error', message: 'The page parameter must be greater than 0!' });
    }
    try {
        const data = await moviesFunc(page);
        return res.status(200).json({ status: 'Ok', data });
    } catch (e) {
        return res.status(500).json({ status: 'Error', message: 'Internal server error' });
    }
};

const singleMovieHandler = async (req, res) => {
    let { year, month, slug } = req.params;
    slug = `/${year}/${month}/${slug}`;
    try {
        const data = await movieFunc(slug);
        if (!data) return res.status(404).json({ status: 'Error', message: 'There\'s nothing here ;_;' });
        return res.status(200).json({ status: 'Ok', data });
    } catch (e) {
        return res.status(500).json({ status: 'Error', message: 'Internal server error' });
    }
};

app.use(cors());

app.use((req, res, next) => {
    next();
});

app.get('/', (_, res) => {

    const totalMem = os.totalmem() / (1024 * 1024 * 1024);
    const freeMem = os.freemem() / (1024 * 1024 * 1024);

    const platform = os.platform();
    const release = os.release();
    const arch = os.arch();

    let diskInfo = {};
    try {
        const df = execSync('df -h /').toString();
        const lines = df.trim().split('\n');
        const parts = lines[1].split(/\s+/);
        diskInfo = {
            size: parts[1],
            used: parts[2],
            avail: parts[3],
            usePercent: parts[4],
            mount: parts[5],
        };
    } catch (e) {
        diskInfo = { error: 'df command failed or not available' };
    }

    res.status(200).json({
        status: 'OK',
        message: 'Scraper API otakudesu',
        system: {
            ram: {
                totalGB: totalMem.toFixed(2),
                freeGB: freeMem.toFixed(2),
            },
            os: {
                platform,
                release,
                arch,
            },
            disk: diskInfo,
        },
    });
});

app.get('/v1/', (_, res) => {
    res.status(200).json({ status: 'Ok', message: 'Scraper API otakudesu' });
});

app.get('/v1/home', homeHandler);
app.get('/v1/search/:keyword', searchAnimeHandler);
app.get('/v1/ongoing-anime/:page?', ongoingAnimeHandler);
app.get('/v1/complete-anime/:page?', completeAnimeHandler);
app.get('/v1/anime/:slug', singleAnimeHandler);
app.get('/v1/anime/:slug/episodes', episodesHandler);
app.get('/v1/anime/:slug/episodes/:episode', episodeByEpisodeNumberHandler);
app.get('/v1/episode/:slug', episodeByEpisodeSlugHandler);
app.get('/v1/batch/:slug', batchByBatchSlugHandler);
app.get('/v1/anime/:slug/batch', batchHandler);
app.get('/v1/genres', genreListsHandler);
app.get('/v1/genres/:slug/:page?', animeByGenreHandler);
app.get('/v1/movies/:page', moviesHandler);
app.get('/v1/movies/:year/:month/:slug', singleMovieHandler);

app.use((_, res) => {
    res.status(404).json({ status: 'Error', message: "There's nothing here ;_;" });
});

module.exports.handler = serverless(app);
