export default class TmdbEpisodeRetriever {
    constructor(oblecto) {
        this.oblecto = oblecto;
    }

    async retrieveInformation(episode) {
        let series = await episode.getSeries();

        let episodeInfo = await this.oblecto.tmdb.tvEpisodeInfo({
            id: series.tmdbid,
            season_number: episode.airedSeason,
            episode_number: episode.airedEpisodeNumber

        });

        let data = {
            episodeName: episodeInfo.name,
            airedEpisodeNumber: episodeInfo.episode_number,
            airedSeason: episodeInfo.season_number,
            overview: episodeInfo.overview,
            firstAired: episodeInfo.air_date
        };

        let externalIds = {};

        if (!(episode.tvdbid && episode.imdbid)) {
            externalIds = await this.oblecto.tmdb.tvEpisodeExternalIds({
                id: series.tmdbid,
                season_number: episode.airedSeason,
                episode_number: episode.airedEpisodeNumber
            });
        }

        if (!episode.tvdbid && externalIds.tvdb_id) {
            data.tvdbid = externalIds.tvdb_id;
        }

        if (!episode.imdbid && externalIds.imdb_id) {
            data.imdbid = externalIds.imdb_id;
        }

        return data;

    }
}
