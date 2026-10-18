// Music page client logic.
// Album data is injected by pages/music.js via window.__ALBUMS__.
// When opened as a standalone file (no injection), it falls back to the
// generated demo dataset so local preview still renders something.

let albumsData = [];
let currentAlbum = null;
let isDarkMode = true;

// High resolution Unsplash artwork array (fallback covers only)
const realCovers = [
    'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?w=600&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=600&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=600&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=600&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=600&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=600&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1459749411175-04bf5292ceea?w=600&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1511379938547-c1f69419868d?w=600&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=600&auto=format&fit=crop&q=80'
];

function getRealCover(index) {
    return realCovers[index % realCovers.length];
}

// Demo dataset used only when no window.__ALBUMS__ is provided (local preview).
function generateExpandedDatabase() {
    const recentSeedData = [
        { title: 'HABIBTI (FOMO)', artist: 'Drake', genre: 'R&B/灵歌', exp: true },
        { title: 'EG.0', artist: 'Ellie Goulding', genre: '流行', exp: true },
        { title: '余红往事 原声带', artist: '李琦 / 毛不易', genre: '影视原声', exp: false },
        { title: 'Songs Without Words', artist: '简妮巴·坎内-梅森', genre: '古典', exp: false },
        { title: 'FATO', artist: 'SteppaG', genre: '嘻哈/说唱', exp: true },
        { title: "Devil's Tax Return", artist: 'Galantis', genre: '电子乐', exp: true },
        { title: 'The Mountain', artist: 'Gorillaz', genre: '独立摇滚', exp: false },
        { title: 'Lost Weekend', artist: 'Phoebe Bridgers', genre: '独立民谣', exp: false },
        { title: 'Sexistential', artist: 'Robyn', genre: '电子舞曲', exp: true },
        { title: 'Inferno', artist: 'Boards Of Canada', genre: '氛围电子', exp: false }
    ];

    const favSeedData = [
        { title: 'Showgirl: The Encore', artist: 'Taylor Swift', genre: '流行', exp: false },
        { title: '自由的你', artist: '邓紫棋', genre: '华语流行', exp: false },
        { title: '要去什么地方', artist: '田馥甄', genre: '华语流行', exp: false },
        { title: 'Day and Night', artist: 'Carly Rae Jepsen', genre: '复古流行', exp: true },
        { title: 'QRŌMELIFE', artist: 'Quavo', genre: 'Trap / 嘻哈', exp: true },
        { title: 'Timeless Nocturne', artist: '周杰伦', genre: '华语流行', exp: false },
        { title: '最伟大的作品', artist: '周杰伦', genre: '华语流行', exp: false },
        { title: '光年之外', artist: '邓紫棋', genre: '华语流行', exp: false },
        { title: '乌托邦里的回声', artist: '陈奕迅', genre: '华语流行', exp: false },
        { title: '平凡之路 10周年', artist: '朴树', genre: '民谣摇滚', exp: false }
    ];

    const list = [];
    function populate(category, seeds) {
        for (let i = 1; i <= 12; i++) {
            const seed = seeds[(i - 1) % seeds.length];
            const suffix = i > seeds.length ? ` Vol. ${Math.ceil(i / seeds.length)}` : '';
            const title = `${seed.title}${suffix}`;
            const id = `${category}-album-${i}`;

            list.push({
                id: id,
                title: title,
                artist: seed.artist,
                genreYear: `${seed.genre} · 2026年`,
                description: `由 ${seed.artist} 打造的精选大碟《${title}》，收录多首精选单曲，带来震撼的无损听觉体验。`,
                cover: getRealCover(i - 1),
                explicit: seed.exp,
                category: category,
                tracks: [
                    { id: `${id}-t1`, title: `${title} - Prelude`, artist: seed.artist, duration: '1:45', explicit: false },
                    { id: `${id}-t2`, title: `Main Anthem`, artist: seed.artist, duration: '3:20', explicit: seed.exp },
                    { id: `${id}-t3`, title: `Outro Echoes`, artist: seed.artist, duration: '2:50', explicit: false }
                ]
            });
        }
    }

    populate('recent', recentSeedData);
    populate('favorites', favSeedData);
    return list;
}

function renderGrids() {
    const recentGrid = document.getElementById('recentlyPlayedGrid');
    const favGrid = document.getElementById('favoritesGrid');

    if (!recentGrid || !favGrid) return;

    // If the server already pre-rendered cards into the grids (build-time
    // pre-fill), keep them to avoid a re-render flicker on first paint.
    if (recentGrid.children.length > 0 && favGrid.children.length > 0) return;

    const recentAlbums = albumsData.filter(a => a.category === 'recent');
    const favAlbums = albumsData.filter(a => a.category === 'favorites');

    recentGrid.innerHTML = gridHtml(recentAlbums);
    favGrid.innerHTML = gridHtml(favAlbums);
}

// Inline styles on purpose: no Tailwind class needed, so this note works even
// if tw.css was built before it existed.
const EMPTY_NOTE = '<p style="grid-column:1/-1;padding:28px 0;font-size:14px;line-height:1.7;color:rgba(255,255,255,.42)">这个分区还是空的 —— 在 Notion「音乐」库里加一行，分类选「最近在听」或「我的收藏」，一小时内自动同步。</p>';

function gridHtml(list) {
    if (!list || list.length === 0) return EMPTY_NOTE;
    return list.slice(0, 12).map(album => createAlbumCardHtml(album)).join('');
}

function createAlbumCardHtml(album) {
    return `
        <div onclick="openAlbumDetail('${album.id}')" class="album-card cursor-pointer group flex flex-col space-y-2">
            <div class="album-card-img-wrapper aspect-square relative shadow-lg">
                <img src="${album.cover}" alt="${album.title}" class="w-full h-full object-cover group-hover:scale-105 transition duration-500" loading="lazy" decoding="async" sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, (max-width: 1024px) 25vw, 16vw">
            </div>
            <div class="min-w-0">
                <div class="flex items-center space-x-1">
                    <h3 class="font-bold text-xs sm:text-sm theme-text-primary truncate group-hover:text-rose-500 transition">${album.title}</h3>
                    ${album.explicit ? '<span class="explicit-badge flex-shrink-0">E</span>' : ''}
                </div>
                <p class="text-[11px] sm:text-xs theme-text-secondary truncate mt-0.5">${album.artist}</p>
            </div>
        </div>
    `;
}

function openCategoryView(categoryKey) {
    const gridView = document.getElementById('albumGridView');
    const categoryView = document.getElementById('categoryDetailView');
    const detailView = document.getElementById('albumDetailView');

    gridView.classList.add('hidden');
    detailView.classList.add('hidden');
    categoryView.classList.remove('hidden');

    const filtered = albumsData.filter(a => a.category === categoryKey);

    document.getElementById('categoryPageTitle').textContent = categoryKey === 'recent' ? '我最近在听' : '我的收藏';
    document.getElementById('categoryCount').textContent = filtered.length;

    const container = document.getElementById('categoryFullGrid');
    container.innerHTML = filtered.map(album => createAlbumCardHtml(album)).join('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openAlbumDetail(albumId) {
    const album = albumsData.find(a => a.id === albumId);
    if (!album) return;

    currentAlbum = album;

    document.getElementById('albumGridView').classList.add('hidden');
    document.getElementById('categoryDetailView').classList.add('hidden');
    document.getElementById('albumDetailView').classList.remove('hidden');

    document.getElementById('detailCover').src = album.cover;
    document.getElementById('detailTitle').textContent = album.title;
    document.getElementById('detailArtist').textContent = album.artist;
    document.getElementById('detailMeta').textContent = album.genreYear;
    document.getElementById('detailDescription').textContent = album.description;
    document.getElementById('detailReleaseDate').textContent = `${album.genreYear} 发行`;

    const explicitBadge = document.getElementById('detailExplicit');
    if (album.explicit) {
        explicitBadge.classList.remove('hidden');
    } else {
        explicitBadge.classList.add('hidden');
    }

    const tracklistContainer = document.getElementById('tracklistContainer');
    tracklistContainer.innerHTML = (album.tracks || []).map((track, idx) => `
        <div onclick="openPlatformModalByTrackIndex(${idx})" class="track-row flex items-center justify-between p-2.5 sm:p-3 rounded-xl cursor-pointer group">
            <div class="flex items-center space-x-3 sm:space-x-4 min-w-0">
                <span class="text-xs sm:text-sm font-semibold theme-text-secondary w-5 text-center flex-shrink-0 group-hover:text-rose-500">${idx + 1}</span>
                <div class="min-w-0">
                    <div class="flex items-center space-x-1.5">
                        <h4 class="text-xs sm:text-sm font-semibold theme-text-primary truncate group-hover:text-rose-500 transition">${track.title}</h4>
                        ${track.explicit ? '<span class="explicit-badge">E</span>' : ''}
                    </div>
                    <p class="text-[11px] theme-text-secondary truncate mt-0.5">${track.artist}</p>
                </div>
            </div>
            <div class="flex items-center space-x-3 text-xs theme-text-secondary">
                <span>${track.duration}</span>
            </div>
        </div>
    `).join('');

    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showGridView() {
    document.getElementById('categoryDetailView').classList.add('hidden');
    document.getElementById('albumDetailView').classList.add('hidden');
    document.getElementById('albumGridView').classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openPlatformModalByTrackIndex(idx) {
    if (!currentAlbum || !currentAlbum.tracks[idx]) return;
    openPlatformModal(currentAlbum.tracks[idx], currentAlbum);
}

function openPlatformModal(track, album) {
    const targetAlbum = album || currentAlbum;
    const targetTrack = track || (targetAlbum ? targetAlbum.tracks[0] : null);
    if (!targetTrack || !targetAlbum) return;

    document.getElementById('modalCover').src = targetAlbum.cover;
    document.getElementById('modalSongTitle').textContent = targetTrack.title;
    document.getElementById('modalArtist').textContent = targetTrack.artist;

    const searchQuery = encodeURIComponent(`${targetTrack.title} ${targetTrack.artist}`);
    const links = targetTrack.links || {};

    // Apple Music / Spotify: keep as search links (no per-song API available).
    // Netease / QQ: prefer the direct song page when we have it, else search.
    document.getElementById('btnAppleMusic').href = `https://music.apple.com/us/search?term=${searchQuery}`;
    document.getElementById('btnSpotify').href = `https://open.spotify.com/search/${searchQuery}`;
    document.getElementById('btnNetease').href = links.netease || `https://music.163.com/#/search/m/?s=${searchQuery}&type=1`;
    document.getElementById('btnQQMusic').href = links.qq || `https://y.qq.com/n/ryqq/search?w=${searchQuery}&t=song`;

    const modal = document.getElementById('platformModal');
    const card = document.getElementById('modalCard');
    modal.classList.remove('pointer-events-none', 'opacity-0');
    card.classList.remove('scale-95');
    card.classList.add('scale-100');
}

function closePlatformModal() {
    const modal = document.getElementById('platformModal');
    const card = document.getElementById('modalCard');
    card.classList.remove('scale-100');
    card.classList.add('scale-95');
    modal.classList.add('opacity-0', 'pointer-events-none');
}

function playAlbumFirstTrack() {
    if (currentAlbum && currentAlbum.tracks.length > 0) {
        openPlatformModal(currentAlbum.tracks[0], currentAlbum);
    }
}

function shuffleAlbumTracks() {
    if (currentAlbum && currentAlbum.tracks.length > 0) {
        const randomIdx = Math.floor(Math.random() * currentAlbum.tracks.length);
        openPlatformModal(currentAlbum.tracks[randomIdx], currentAlbum);
    }
}

function handleSearch(val) {
    const clearBtn = document.getElementById('searchClearBtn');
    const query = val.trim().toLowerCase();

    if (query.length > 0) {
        clearBtn.classList.remove('hidden');
        const filtered = albumsData.filter(a =>
            a.title.toLowerCase().includes(query) ||
            a.artist.toLowerCase().includes(query)
        );

        document.getElementById('recentlyPlayedGrid').innerHTML = filtered.slice(0, 12).map(a => createAlbumCardHtml(a)).join('');
        document.getElementById('favoritesGrid').innerHTML = filtered.slice(12, 24).map(a => createAlbumCardHtml(a)).join('');
    } else {
        clearBtn.classList.add('hidden');
        renderGrids();
    }
}

function clearSearch() {
    const input = document.getElementById('searchInput');
    input.value = '';
    handleSearch('');
}

function toggleTheme() {
    isDarkMode = !isDarkMode;
    const body = document.body;
    const icon = document.getElementById('themeIcon');
    if (isDarkMode) {
        body.classList.remove('light-theme');
        icon.className = 'fa-solid fa-moon text-xs sm:text-base';
    } else {
        body.classList.add('light-theme');
        icon.className = 'fa-solid fa-sun text-xs sm:text-base text-amber-500';
    }
}

function initMusicPage() {
    albumsData = (window.__ALBUMS__ && window.__ALBUMS__.length)
        ? window.__ALBUMS__
        : generateExpandedDatabase();
    renderGrids();
}

// next/script afterInteractive runs AFTER DOMContentLoaded has already fired,
// so a plain DOMContentLoaded listener would never trigger. Handle both cases.
if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', initMusicPage);
} else {
    initMusicPage();
}
