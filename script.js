const state = {
  movies: [],
  promotions: [],
  filter: "all",
  query: ""
};

const movieGrid = document.getElementById("movieGrid");
const movieCount = document.getElementById("movieCount");
const emptyState = document.getElementById("emptyState");
const searchInput = document.getElementById("searchInput");
const filterBar = document.getElementById("filterBar");
const modal = document.getElementById("modal");

const escapeHtml = (value = "") =>
  String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[character]));

function isMatch(movie) {
  const searchable = [
    movie.title,
    movie.description,
    movie.language,
    movie.type,
    ...(movie.genres || [])
  ].join(" ").toLowerCase();

  const matchesSearch = searchable.includes(state.query.toLowerCase());

  if (state.filter === "all") return matchesSearch;
  if (state.filter === "movie") return matchesSearch && movie.type === "movie";
  if (state.filter === "series") return matchesSearch && movie.type === "series";

  return matchesSearch && searchable.includes(state.filter);
}

function getSafeUrl(url) {
  try {
    const parsed = new URL(url);
    return ["https:", "http:"].includes(parsed.protocol) ? parsed.href : "#";
  } catch {
    return "#";
  }
}

function renderMovies() {
  const visibleMovies = state.movies.filter(isMatch);

  movieGrid.innerHTML = visibleMovies.map((movie) => `
    <article class="movie-card" data-id="${escapeHtml(movie.id)}" tabindex="0" role="button" aria-label="View ${escapeHtml(movie.title)} details">
      <div class="poster-wrap">
        <img src="${escapeHtml(movie.poster)}" alt="${escapeHtml(movie.title)} poster" loading="lazy">
        <span class="card-type">${movie.type === "series" ? "SERIES" : "MOVIE"}</span>
        <span class="card-rating">★ ${escapeHtml(movie.rating || "N/A")}</span>
      </div>
      <div class="card-body">
        <h3 class="card-title">${escapeHtml(movie.title)}</h3>
        <div class="card-meta">
          <span>${escapeHtml(movie.releaseDate || "N/A")}</span>
          <span>•</span>
          <span>${escapeHtml(movie.language || "N/A")}</span>
        </div>
      </div>
    </article>
  `).join("");

  movieCount.textContent = `${visibleMovies.length} title${visibleMovies.length === 1 ? "" : "s"}`;
  emptyState.hidden = visibleMovies.length !== 0;
}

function openModal(movieId) {
  const movie = state.movies.find((item) => item.id === movieId);
  if (!movie) return;

  document.getElementById("modalPoster").src = movie.poster;
  document.getElementById("modalPoster").alt = `${movie.title} poster`;
  document.getElementById("modalType").textContent = movie.type === "series" ? "WEB SERIES" : "MOVIE";
  document.getElementById("modalTitle").textContent = movie.title;
  document.getElementById("modalDescription").textContent = movie.description || "No description available.";
  document.getElementById("modalRating").textContent = movie.rating || "Not rated";
  document.getElementById("modalDuration").textContent = movie.duration || "Not specified";
  document.getElementById("modalLanguage").textContent = movie.language || "Not specified";
  document.getElementById("modalDate").textContent = movie.releaseDate || "Not specified";
  document.getElementById("modalGenres").textContent = (movie.genres || []).join(" • ");

  const downloadButton = document.getElementById("downloadButton");
  const watchButton = document.getElementById("watchButton");

  downloadButton.href = getSafeUrl(movie.telegramLink);
  watchButton.href = getSafeUrl(movie.watchLink);

  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeModal() {
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function renderPromotions() {
  const activePromotions = state.promotions.filter((promo) => promo.active);
  const top = activePromotions.find((promo) => promo.position === "top");
  const bottom = activePromotions.find((promo) => promo.position === "bottom");

  renderPromotion("promoTop", top);
  renderPromotion("promoBottom", bottom);
}

function renderPromotion(elementId, promo) {
  const holder = document.getElementById(elementId);
  if (!promo) {
    holder.innerHTML = "";
    return;
  }

  const style = promo.image
    ? `style="background-image: url('${escapeHtml(promo.image)}')"`
    : "";

  holder.innerHTML = `
    <a class="promotion ${promo.image ? "has-image" : ""}" href="${getSafeUrl(promo.link)}" target="_blank" rel="noopener noreferrer" ${style}>
      <div>
        <p>PROMOTED</p>
        <h3>${escapeHtml(promo.title)}</h3>
      </div>
      <span class="button button-primary">${escapeHtml(promo.buttonText || "Explore")}</span>
    </a>
  `;
}

async function loadData() {
  try {
    const [moviesResponse, promotionsResponse] = await Promise.all([
      fetch("./data/movies.json", { cache: "no-store" }),
      fetch("./data/promotions.json", { cache: "no-store" })
    ]);

    if (!moviesResponse.ok) throw new Error("Could not load movie data.");

    state.movies = await moviesResponse.json();
    state.promotions = promotionsResponse.ok ? await promotionsResponse.json() : [];

    renderMovies();
    renderPromotions();
  } catch (error) {
    movieGrid.innerHTML = `
      <div class="empty-state">
        <p>Website data is being prepared. Please check back shortly.</p>
      </div>
    `;
    movieCount.textContent = "";
    console.error(error);
  }
}

movieGrid.addEventListener("click", (event) => {
  const card = event.target.closest(".movie-card");
  if (card) openModal(card.dataset.id);
});

movieGrid.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const card = event.target.closest(".movie-card");
  if (card) {
    event.preventDefault();
    openModal(card.dataset.id);
  }
});

filterBar.addEventListener("click", (event) => {
  const button = event.target.closest(".filter-chip");
  if (!button) return;

  document.querySelectorAll(".filter-chip").forEach((chip) => {
    chip.classList.toggle("active", chip === button);
  });

  state.filter = button.dataset.filter;
  renderMovies();
});

searchInput.addEventListener("input", (event) => {
  state.query = event.target.value.trim();
  renderMovies();
});

document.getElementById("clearSearchButton").addEventListener("click", () => {
  state.query = "";
  searchInput.value = "";
  state.filter = "all";

  document.querySelectorAll(".filter-chip").forEach((chip) => {
    chip.classList.toggle("active", chip.dataset.filter === "all");
  });

  renderMovies();
});

document.querySelectorAll("[data-close-modal]").forEach((element) => {
  element.addEventListener("click", closeModal);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeModal();
});

const menuButton = document.getElementById("menuButton");
const mobileMenu = document.getElementById("mobileMenu");
const closeMenuButton = document.getElementById("closeMenuButton");

menuButton.addEventListener("click", () => {
  mobileMenu.classList.add("open");
  mobileMenu.setAttribute("aria-hidden", "false");
});

closeMenuButton.addEventListener("click", () => {
  mobileMenu.classList.remove("open");
  mobileMenu.setAttribute("aria-hidden", "true");
});

document.getElementById("year").textContent = new Date().getFullYear();

loadData();
