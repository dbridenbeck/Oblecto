import path from 'path';
import fs from 'fs';
import databases from '../../../submodules/database';
import queue from '../../../submodules/queue';
import tmdb from '../../../submodules/tmdb';
import UserManager from '../../../submodules/users';
import config from '../../../config.js';
import guessit from '../../../submodules/guessit';
import ffprobe from '../../../submodules/ffprobe';

import MovieSetCollector from './MovieSetCollector';


async function identifyByTMDB (basename) {
    var identification = await guessit.identify(basename);

    let query = {query: identification.title};

    if (identification.year) {
        query.primary_release_year = identification.year;
    }

    return await tmdb.searchMovie(query);
}

export default async function (moviePath, reIndex) {
    let metadata = {};
    let duration = 0;

    try {
        metadata = await ffprobe(moviePath);
        duration = metadata.format.duration;
    } catch (e) {
        console.log('Could not analyse ', moviePath, ' for duration');
    }

    let parsedPath = path.parse(moviePath);
    parsedPath.ext = parsedPath.ext.replace('.', '').toLowerCase()

    // Create file entity in the database
    let [file, FileInserted] = await databases.file.findOrCreate({
        where: {path: moviePath},
        defaults: {
            name: parsedPath.name,
            directory: parsedPath.dir,
            extension: parsedPath.ext,

            duration
        }
    });

    if (FileInserted) {
        console.log('File inserted:', moviePath);
    } else {
        console.log('File already in database:', moviePath);

        // Don't both indexing the file if it's already in the file database.
        // It was probably already indexed
        if (!reIndex) {
            return false;
        }
    }

    let results = []

    let IdentificationSources = [
        identifyByTMDB
    ];

    let IdentificationTitles = [
        parsedPath.name,
        path.basename(parsedPath.dir)
    ];

    for (const source of IdentificationSources) {
        for (const title of IdentificationTitles) {
            results.push(await source(title));
        }
    }

    let FinalResult = results[0];

    for (const result of results) {
        if (result.total_results < FinalResult.total_results && result.total_results > 0) {
            FinalResult = result;
        }
    }

    if (FinalResult.total_results === 0) {
        console.log(moviePath, 'could not be identified');
        return false
    }


    let data = FinalResult.results[0];

    console.log(data);

    let [movie, MovieInserted] = await databases.movie
        .findOrCreate({
            where: {tmdbid: data.id}, defaults: {
                movieName: data.title,
                popularity: data.popularity,
                releaseDate: data.release_date,
                overview: data.overview,
                file: moviePath
            }
        });

    movie.addFile(file);

    MovieSetCollector.GetSetsForMovie(movie);


    if (MovieInserted) {
        console.log(movie.movieName, 'added to database');

        // Inform all connected clients that a new movie has been imported
        UserManager.sendToAll('indexer', {event: 'added', type: 'movie'});
    } else {
        console.log(movie.movieName, 'was already in the database');
    }

    if (config.transcoding[file.extension] !== undefined && config.transcoding[file.extension] !== false) {
        queue.push({task: 'transcode', path: moviePath}, async function (err) {
            // Determine the file path of the transcoded file
            let parsed = path.parse(moviePath);
            let extension = parsed.ext.replace('.', '').toLowerCase();
            let transcodedPath = moviePath.replace(parsed.ext, '.' + config.transcoding[extension]);

            // Insert the new file and link it to the movie entity
            let [file, FileInserted] = await databases.file.findOrCreate({
                where: {path: transcodedPath},
                defaults: {
                    name: path.parse(transcodedPath).name,
                    directory: path.parse(transcodedPath).dir,
                    extension: path.parse(transcodedPath).ext.replace('.', '').toLowerCase()
                }
            });


            movie.addFile(file).then(() => {
                movie.save();
            });
        });
    }

    return true;
}