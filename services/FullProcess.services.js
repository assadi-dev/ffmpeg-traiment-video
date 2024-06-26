import {
  CONTAINER_EVASION,
  DIRECTORY_SEPARATOR,
  EVASION_API,
  FTP_CREDENTIALS,
  FTP_DESTINATION_DIR,
  FTP_ENDPOINT,
  OVH_CONTAINER,
  OVH_CREDENTIALS,
  WEBSOCKET_PATH,
  upload_dir,
} from "../config/constant.config.js";
import { feedbackStatus } from "../config/ffmpegComand.config.js";
import { ws } from "../index.js";
import {
	generate_thumbnail,
	gopro_equirectangular,
	insv_equirectangular,
	insv_equirectangular_x3,
	merge_insv,
	video_compress,
} from "./FFmpegCameraProcess.services.js";
import { chmodSync, existsSync, mkdirSync, unlinkSync } from "fs";
import FTPServices from "./FTPServices.services.js";
import OvhObjectStorageServices from "./OvhObjectStorage.services.js";
import { postDelayed, removeFile } from "./Filestype.services.js";
import { DEFAULT_DELETE_FILE_DELAY } from "../config/event.js";
import { LogSystem } from "./LogSystem.services.js";
import FFmpegInstance from "./FFmpegInstance.services.js";

export const full_process_gopro = async (idProjectVideo, fileObject) => {
	const room = fileObject?.room;
	const id = fileObject.id;
	let statusStep = feedbackStatus;
	statusStep.id = id;
	statusStep.camera = "gopro";
	statusStep.step = "equirectangular";
	statusStep.filename = fileObject.filename;

	try {
		console.log(`Wait gopro equirectangular for project ${idProjectVideo}`);

		logVideoProcess(
			"Traitement video",
			`Wait gopro equirectangular for project ${idProjectVideo}`
		);

		ws.of(WEBSOCKET_PATH).to(room).emit("start", statusStep);

		const equirectangular = await gopro_equirectangular(fileObject);
		const lowFilename = equirectangular.filename.replace(".mp4", "_low.mp4");

		const fileObjectCompress = {
			id,
			camera: fileObject.camera,
			room: fileObject.room,
			filename: fileObject.filename,
			input: equirectangular.output,
			output: `${upload_dir}${DIRECTORY_SEPARATOR}${lowFilename}`,
		};

		console.log("Upload_dir", upload_dir);
		console.log(
			`Start compress for ${equirectangular.filename} on project ${idProjectVideo}`
		);
		logVideoProcess(
			"Traitement video",
			`Start compress for ${equirectangular.filename}`
		);

		const compress_response = await video_compress(fileObjectCompress);

		const high_quality = equirectangular.output;
		const low_quality = compress_response.output;

		const duration = compress_response.duration; //await extract_duration(low_quality);

		//Envoie FTP
		console.log(
			"Start send FTP for" + lowFilename + " on project " + idProjectVideo
		);
		logVideoProcess(
			"Traitement video",
			`start send FTP ` + lowFilename + " on project " + idProjectVideo
		);
		const ftp_destination = `${FTP_DESTINATION_DIR}/${lowFilename}`;
		const URL_LOW = await sendProcess(low_quality, ftp_destination, lowFilename);

		//Génération Thumbnail
		console.log("Start generation thumbnail for " + lowFilename);
		logVideoProcess("Traitement video", `generation thumbnail` + lowFilename);
		const folderName = equirectangular.filename.replace(".mp4", "");
		const thumbDestination = `${upload_dir}${DIRECTORY_SEPARATOR}project_${idProjectVideo}${DIRECTORY_SEPARATOR}${folderName}`;
		if (!existsSync(thumbDestination)) {
			mkdirSync(thumbDestination, { recursive: true });
			chmodSync(thumbDestination, "777");
			//if (platform == "darwin") await darwinChmod(thumbDestination);
		}

		const thumbnailsPath = await generate_thumbnail(
			low_quality,
			thumbDestination
		);

		//Upload vignette vers ovh
		console.log(
			"Upload thumbnail to ovh for file " +
				lowFilename +
				" on project " +
				idProjectVideo
		);
		const thumbnails = await upload_thumbnail_to_ovh(
			thumbnailsPath,
			folderName + ".jpeg"
		);
		console.log(
			"Finish upload thumbnail for file " +
				lowFilename +
				" on project " +
				idProjectVideo
		);
		remove_file_delayed(low_quality, DEFAULT_DELETE_FILE_DELAY);

		//Envoie OVH
		console.log(
			"Start send OVH for file " + high_quality + " on project " + idProjectVideo
		);
		logVideoProcess(
			"Traitement video",
			`start send OVH` + high_quality + " on project " + idProjectVideo
		);
		const finalFileObject = {
			id,
			camera: fileObject.camera,
			filePath: high_quality,
			remoteFilename: equirectangular.filename,
		};
		const URL_HIGH = await upload_ovh(room, finalFileObject);
		console.table({ high_quality: URL_HIGH, low_quality: URL_LOW });
		logVideoProcess(
			"Available file ovh",
			JSON.stringify({ high_quality: URL_HIGH, low_quality: URL_LOW })
		);

		//Update user project
		const projectData = {
			idProjectVideo,
			urlVideo: URL_HIGH,
			urlVideoLight: URL_LOW,
			thumbnails: thumbnails,
			duration,
		};

		const resUpdateProject = await update_project_360(projectData);

		resUpdateProject.ok
			? emitVideoMade(room, await resUpdateProject.json())
			: (async () => {
					console.log("Une erreur est survenue");
					logErrorVideoProcess(
						"Update projectVideo",
						`Une erreur est survenue lors de la mise à jour du projet: ${await resUpdateProject.json()}`
					);
			  })();
	} catch (error) {
		console.log(error.message);
		logErrorVideoProcess("Traitement Video", `Erreur: ${error.message}`);
		statusStep.error = error.message;
		statusStep.message = "error";
		ws.of(WEBSOCKET_PATH).to(room).emit("error", statusStep);
		return error;
	}
};

export const full_process_insv = async (idProjectVideo, fileObject) => {
	const room = fileObject?.room;
	let status = feedbackStatus;
	const filename = fileObject.filename;
	const id = fileObject.id;

	status.id = id;
	status.camera = "insv";
	status.step = "fusion";
	status.filename = filename;

	try {
		console.log(`Wait fusion insv for ${filename} for project ${idProjectVideo}`);
		logVideoProcess(
			"Traitement video",
			`Wait fusion insv for camera ${status.camera} - mode: ${status.model} for project ${idProjectVideo}`
		);
		ws.of(WEBSOCKET_PATH).to(room).emit("start", status);
		const fusion = await merge_insv(fileObject);
		let toEquirectangular = {
			id,
			room,
			filename: fusion.filename,
			finalFilename: fusion.finalFilename,
			input: fusion.output,
		};
		console.log(
			`wait equirectangular insv for ${filename} for project ${idProjectVideo}`
		);
		logVideoProcess(
			"Traitement video",
			`Wait equirectangular insv for ${filename}`,
			`for project ${idProjectVideo}`
		);

		const equirectangularInsv = await insv_equirectangular(toEquirectangular);
		//unlinkSync(toEquirectangular.input);
		// postDelayed(5000, () => removeFile(toEquirectangular.input));

		console.log(
			`Wait compress insv for ${filename}` + " for project " + idProjectVideo
		);
		logVideoProcess(
			"Traitement video",
			`wait compress insv for ${filename} for project ${idProjectVideo}`
		);
		const lowFilename = equirectangularInsv.filename.replace(".mp4", "_low.mp4");

		const fileObjectCompress = {
			id,
			camera: fileObject.camera,
			room,
			filename: filename,
			input: equirectangularInsv.output,
			output: `${upload_dir}${DIRECTORY_SEPARATOR}${lowFilename}`,
		};
		const compress_response = await video_compress(fileObjectCompress);
		const high_quality = equirectangularInsv.output;
		const low_quality = compress_response.output;
		const duration = compress_response.duration; // await extract_duration(low_quality);
		//Envoie FTP
		logVideoProcess("Traitement video", `start send FTP`);
		const ftp_destination = `${FTP_DESTINATION_DIR}/${lowFilename}`;
		const URL_LOW = await sendProcess(low_quality, ftp_destination, lowFilename);

		//Generation thumbnail
		console.log(
			"Generation thumbnail for " + lowFilename + " on project " + idProjectVideo
		);
		logVideoProcess(
			"Traitement video",
			`generation thumbnail` + lowFilename + " on project " + idProjectVideo
		);
		const folderName = equirectangularInsv.filename.replace(".mp4", "");
		const thumbDestination = `${upload_dir}${DIRECTORY_SEPARATOR}project_${idProjectVideo}${DIRECTORY_SEPARATOR}${folderName}`;
		if (!existsSync(thumbDestination)) {
			mkdirSync(thumbDestination, { recursive: true });
			chmodSync(thumbDestination, "777");
			//if (platform == "darwin") await darwinChmod(thumbDestination);
		}

		const thumbnailsPath = await generate_thumbnail(
			low_quality,
			thumbDestination
		);
		//Upload vignette vers ovh
		console.log(
			"Upload thumbnail to ovh" + lowFilename + " on project " + idProjectVideo
		);
		const thumbnails = await upload_thumbnail_to_ovh(
			thumbnailsPath,
			folderName + ".jpeg"
		);
		console.log(
			"Finish upload thumbnail" + lowFilename + " on project " + idProjectVideo
		);
		remove_file_delayed(low_quality, DEFAULT_DELETE_FILE_DELAY);
		//Envoie OVH
		console.log(
			"Start send OVH for " + high_quality + " on project " + idProjectVideo
		);
		logVideoProcess(
			"Traitement video",
			`start send OVH` + " on project " + idProjectVideo
		);
		const finalFileObject = {
			id,
			camera: fileObject.camera,
			filePath: high_quality,
			remoteFilename: equirectangularInsv.filename,
		};
		const URL_HIGH = await upload_ovh(room, finalFileObject);

		console.table({ high_quality: URL_HIGH, low_quality: URL_LOW });
		logVideoProcess(
			"Available file ovh",
			JSON.stringify({ high_quality: URL_HIGH, low_quality: URL_LOW })
		);
		//Update user project
		const projectData = {
			idProjectVideo,
			urlVideo: URL_HIGH,
			urlVideoLight: URL_LOW,
			thumbnails,
			duration,
		};

		const resUpdateProject = await update_project_360(projectData);
		resUpdateProject.ok
			? emitVideoMade(room, await resUpdateProject.json())
			: (async () => {
					console.log("Une erreur est survenue");
					logErrorVideoProcess(
						"Update projectVideo",
						`Une erreur est survenue lors de la mise à jour du projet: ${await resUpdateProject.json()}`
					);
			  })();
	} catch (error) {
		console.log(error.message);
		status.error = error.message;
		logErrorVideoProcess("Traitement Video", `Erreur: ${error.message}`);
		status.message = "error";
		ws.of(WEBSOCKET_PATH).to(room).emit("error", status);
		return error;
	}
};

export const full_process_insv_x3 = async (idProjectVideo, fileObject) => {
	const room = fileObject?.room;
	let status = feedbackStatus;
	const filename = fileObject.filename;
	const id = fileObject.id;

	status.id = id;
	status.camera = "insv";
	status.step = "fusion";
	status.filename = filename;

	try {
		console.log(
			`Wait fusion insv for ${filename}` + " on project " + idProjectVideo
		);
		logVideoProcess(
			"Traitement video",
			`Wait fusion insv for camera ${status.camera} - mode: ${status.model}`,
			`for project ${idProjectVideo}`
		);
		ws.of(WEBSOCKET_PATH).to(room).emit("start", status);
		const fusion = await merge_insv(fileObject);
		let toEquirectangular = {
			id,
			room,
			filename: fusion.filename,
			finalFilename: fusion.finalFilename,
			input: fusion.output,
		};
		console.log(
			`Wait equirectangular insv for ${filename}` + " on project " + idProjectVideo
		);
		logVideoProcess(
			"Traitement video",
			`Wait equirectangular insv x3 for ${filename}`,
			`for project ${idProjectVideo}`
		);
		const equirectangularInsv = await insv_equirectangular_x3(toEquirectangular);
		//unlinkSync(toEquirectangular.input);

		console.log(
			`Wait compress insv for ${filename}` + " on project " + idProjectVideo
		);
		logVideoProcess(
			"Traitement video",
			`Wait compress insv x3 for ${filename}` + " on project " + idProjectVideo
		);

		const lowFilename = equirectangularInsv.filename.replace(".mp4", "_low.mp4");

		const fileObjectCompress = {
			id,
			camera: fileObject.camera,
			room,
			filename: filename,
			input: equirectangularInsv.output,
			output: `${upload_dir}${DIRECTORY_SEPARATOR}${lowFilename}`,
		};
		const compress_response = await video_compress(fileObjectCompress);
		const high_quality = equirectangularInsv.output;
		const low_quality = compress_response.output;
		const duration = compress_response.duration; //await extract_duration(low_quality);

		//Envoie FTP
		console.log("Start send FTP" + lowFilename + " on project " + idProjectVideo);
		logVideoProcess(
			"Traitement video",
			`start send FTP` + lowFilename + " on project " + idProjectVideo
		);
		const ftp_destination = `${FTP_DESTINATION_DIR}/${lowFilename}`;
		const URL_LOW = await sendProcess(low_quality, ftp_destination, lowFilename);

		//Generation thumbnail
		console.log(
			"Generation thumbnail" + lowFilename + " on project " + idProjectVideo
		);
		logVideoProcess("Traitement video", `generation thumbnail` + lowFilename);
		const folderName = equirectangularInsv.filename.replace(".mp4", "");
		const thumbDestination = `${upload_dir}${DIRECTORY_SEPARATOR}project_${idProjectVideo}${DIRECTORY_SEPARATOR}${folderName}`;
		if (!existsSync(thumbDestination)) {
			mkdirSync(thumbDestination, { recursive: true });
			chmodSync(thumbDestination, "777");
			//if (platform == "darwin") await darwinChmod(thumbDestination);
		}

		const thumbnailsPath = await generate_thumbnail(
			low_quality,
			thumbDestination
		);

		//Upload vignette vers ovh
		console.log(
			"Upload thumbnail to ovh" + lowFilename + " on project " + idProjectVideo
		);
		const thumbnails = await upload_thumbnail_to_ovh(
			thumbnailsPath,
			folderName + ".jpeg"
		);
		console.log(
			"Finish upload thumbnail" + lowFilename + " on project " + idProjectVideo
		);
		remove_file_delayed(low_quality, DEFAULT_DELETE_FILE_DELAY);

		//Envoie OVH
		console.log(
			"Start send OVH" + high_quality + " on project " + idProjectVideo
		);
		logVideoProcess(
			"Traitement video",
			`start send OVH` + high_quality + " on project " + idProjectVideo
		);
		const finalFileObject = {
			id,
			camera: fileObject.camera,
			filePath: high_quality,
			remoteFilename: equirectangularInsv.filename,
		};
		const URL_HIGH = await upload_ovh(room, finalFileObject);

		console.table({ high_quality: URL_HIGH, low_quality: URL_LOW });
		logVideoProcess(
			"Available file ovh",
			JSON.stringify({ high_quality: URL_HIGH, low_quality: URL_LOW })
		);
		//Update user project
		const projectData = {
			idProjectVideo,
			urlVideo: URL_HIGH,
			urlVideoLight: URL_LOW,
			thumbnails,
			duration,
		};

		const resUpdateProject = await update_project_360(projectData);
		resUpdateProject.ok
			? emitVideoMade(room, await resUpdateProject.json())
			: (async () => {
					console.log("Une erreur est survenue" + " on project " + idProjectVideo);
					logErrorVideoProcess(
						"Update projectVideo",
						`Une erreur est survenue lors de la mise à jour du projet: ${await resUpdateProject.json()}`,
						`for project ${idProjectVideo}`
					);
			  })();
	} catch (error) {
		console.log(error.message);
		status.error = error.message;
		status.message = "error";
		ws.of(WEBSOCKET_PATH).to(room).emit("error", status);
		return error;
	}
};

/**
 * Envois du fichier vers le serveur ftp
 * @param {*} source emplacement du fichier source
 * @param {*} destination emplacement du fichier de destination
 * @param {*} filename nom du fichier distant
 * @returns le liens ftp du fichiers uploadé
 */
const sendProcess = async (source, destination, filename) => {
	try {
		const ftpservices = new FTPServices(FTP_CREDENTIALS);
		await ftpservices.connect();
		await ftpservices.send(source, destination);
		const link = `${FTP_ENDPOINT}/${filename}`;
		return link;
	} catch (error) {
		throw new Error(error);
	}
};

const upload_ovh = (room, fileObject) => {
	return new Promise(async (resolve, reject) => {
		const { id, camera, filePath, remoteFilename } = fileObject;

		if (!existsSync(filePath)) {
			console.log("Fichier introuvable");
			return reject(new Error("File not found"));
		}

		const status = {
			id,
			step: "ovh",
			camera,
			message: "idle",
			filename: remoteFilename,
			progress: 0,
			url: "",
			error: "",
		};

		try {
			const ovhStorageServices = new OvhObjectStorageServices(OVH_CREDENTIALS);

			const options = {
				filePath,
				remoteFilename,
				containerName: OVH_CONTAINER,
				segmentSize: 1024 * 1024 * 50,
			};
			await ovhStorageServices.connect();
			ovhStorageServices.uploadLargeFile(options);
			const listen = (progress) => {
				const percent = Math.ceil(progress * 100);
				status.progress = percent;
				status.message = "progress";
				ws.of(WEBSOCKET_PATH).to(room).emit("progress", status);
			};
			ovhStorageServices.onProgress(listen);
			const finish = (response) => {
				status.progress = 100;
				status.message = "done";
				status.url = response?.url;
				ws.of(WEBSOCKET_PATH).to(room).emit("end", status);
				remove_file_delayed(filePath, DEFAULT_DELETE_FILE_DELAY);
				resolve(response?.url);
			};
			ovhStorageServices.onSuccess(finish);
		} catch (error) {
			const message = error.message;
			console.error("Upload error:", message);
			logErrorVideoProcess("Upload OVH error", `Erreur: ${message}`);
			reject(message);
		}
	});
};

/**
 *
 * @param {string} thumbnailPath
 * @param {string} thumbnailFileName
 * @return {Promise<string>} retourne le lien ovh du thumbnail
 *
 */
const upload_thumbnail_to_ovh = (thumbnailPath, thumbnailFileName) => {
	return new Promise((resolve) => {
		try {
			const ovhStorageServices = new OvhObjectStorageServices(OVH_CREDENTIALS);
			ovhStorageServices.setContainer(CONTAINER_EVASION);

			(async () => {
				if (!existsSync(thumbnailPath)) {
					console.log("Fichier introuvable");
					throw new Error("File not found");
				}

				await ovhStorageServices.connect();
				const ovhLink = await ovhStorageServices.singleUploadByPath(
					thumbnailPath,
					thumbnailFileName
				);
				resolve(ovhLink);
				logVideoProcess(
					`Upload thumbnail", "Finish upload thumbnail ovh: ${ovhLink}`
				);
			})();
		} catch (error) {
			console.log("Error upload thumbnail: ", error.message);
			logErrorVideoProcess(
				"Error Upload thumbnail OVH",
				`Erreur: ${error.message}`
			);
		}
	});
};
/**
 * Met le jsonStep du projet en progress
 * @param {*} idProjectVideo
 *
 */
export const send_progress_project_360 = (idProjectVideo) => {
	const url = `${EVASION_API}/v2/project/new/progress`;
	return fetch(url, {
		method: "POST",
		body: JSON.stringify({ idProjectVideo }),
	});
};

const update_project_360 = (body) => {
	const url = `${EVASION_API}/v2/project/update/import`;
	return fetch(url, {
		method: "POST",
		body: JSON.stringify(body),
	});
};

/**
 * Notifie le données videoMade360 créer
 */
const emitVideoMade = async (room, result) => {
	ws.of(WEBSOCKET_PATH).to(room).emit("project-data", result);
};

/**
 * Suppression du fichier
 * @param {String} filePath
 */
export const remove_file = (filePath) => {
	try {
		if (!existsSync(filePath)) {
			chmodSync(filePath, "777");
			unlinkSync(filePath);
		}
	} catch (error) {
		console.log("[Error]", error.message);
		console.log(
			"Impossible de supprimé le fichier se trouvant à l'emplacement" + filePath
		);
		logErrorVideoProcess(
			"Remove file",
			"Impossible de supprimé le fichier se trouvant " + filePath
		);
	}
};

/**
 * Suppression du fichier après un délai
 * @param {String} filePath Emplacement du fichier
 * @param {Number} delay Delay en ms
 */
export const remove_file_delayed = (filePath, delay) => {
  return postDelayed(delay, () => removeFile(filePath));
};

/**
 * Message à enregistré dans le fichier des logs
 * @param {string} title Titre du message
 * @param {string} message Message à affiché
 */
export const logVideoProcess = (title, message) => {
  const logger = new LogSystem();
  logger.setLabel(title);
  logger.setInfo(message);
};

/**
 * Message d'erreur à enregistré dans le fichier des logs
 * @param {string} title Titre du message
 * @param {string} message Message à affiché
 */
export const logErrorVideoProcess = (title, message) => {
  const logger = new LogSystem();
  logger.setLabel(title);
  logger.setError(message);
};

/**
 * Obtenir les metadata du fichier
 */
export const extract_metadata = (input) => {
  const { ffmpeg } = new FFmpegInstance();
  return new Promise((resolve, reject) => {
    ffmpeg.input(input);
    ffmpeg.ffprobe(input, (err, metadata) => {
      if (err) reject(err);
      resolve(metadata);
    });
  });
};
