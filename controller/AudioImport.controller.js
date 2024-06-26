import { createReadStream, statSync } from "fs";
import {
  CONTAINER_EVASION,
  DIRECTORY_SEPARATOR,
  EVASION_API,
  OVH_CREDENTIALS,
  WEBSOCKET_PATH,
  upload_dir,
} from "../config/constant.config.js";
import tinyStorageClient from "tiny-storage-client";
import { ws } from "../index.js";
import {
  clean_file_process,
  extract_duration,
} from "../services/FFmpegCameraProcess.services.js";
import process from "process";

export const import_audio = (req, res) => {
	try {
		const room = req.body?.room?.toString();
		const idProjectVideo = req.body?.idProjectVideo;
		const audioFiles = req.body.files;

		const filesProcess = [];

		for (const audio of audioFiles) {
			const tmp_audio = { ...audio };

			tmp_audio.filepath = tmp_audio.path.replace(
				"uploads/",
				`${upload_dir}${DIRECTORY_SEPARATOR}`
			);

			const result = upload_audio_process(room, tmp_audio).then(async (res) => {
				const { url, filename } = res;
				const duration = await extract_duration(tmp_audio.filepath);
				const audioData = {
					filename,
					urlAudio: url,
					duration: duration || tmp_audio.duration,
				};
				const resp = await updateAudioMade360(idProjectVideo, audioData);
				const audioFile = await resp.json();

				ws
					.of(process.env.WEBSOCKET_PATH)
					.to(room)
					.emit("audio-import-data", audioFile);
			});

			filesProcess.push(result);
		}

		res.json({
			idProjectVideo,
			room,
			files: audioFiles,
			count: audioFiles.length,
		});
	} catch (error) {
		const message = error.message;
		console.error("Upload error:", message);
		res.json({ message });
	}
};

const upload_audio_process = async (room, audioObject) => {
	const status = {
		id: audioObject.id,
		step: "ovh",
		message: "start",
		filename: audioObject.filename,
		progress: 0,
		url: "",
		error: "",
		type: "audio",
	};

	const clientStorage = tinyStorageClient(OVH_CREDENTIALS);
	const { filepath, filename } = audioObject;
	const { size } = statSync(filepath);
	const readStream = createReadStream(filepath);

	return new Promise((resolve) => {
		try {
			clientStorage.connection(() => {
				const stream = () => {
					let read = 0;
					readStream.on("data", (chunk) => {
						read += chunk.length;
						const progress = Math.round((100 * read) / size);
						listen(room, status, progress);
					});

					return readStream;
				};

				clientStorage.uploadFile(CONTAINER_EVASION, filename, stream, (err) => {
					if (err) {
						return "Error send file OVH";
					}
					const url = `${OVH_CREDENTIALS.endpoint}/${encodeURI(
						CONTAINER_EVASION
					)}/${filename}`;

					finish(room, status, filepath);
					status.progress = 100;
					ws.of(WEBSOCKET_PATH).to(room).emit("end", status);

					resolve({
						url: url,
						filename,
						size,
					});
				});
			});
		} catch (error) {
			throw new Error(error.message);
		}
	});
};

const listen = (room, status, progress) => {
  status.progress = progress;
  status.message = "progress";
  // console.log("progress upload", progress + "%");
  ws.of(WEBSOCKET_PATH).to(room).emit("progress", status);
};

const finish = async (room, status, filePath) => {
  status.progress = 100;
  status.message = "done";

  console.log("finish upload audio");
  ws.of(WEBSOCKET_PATH).to(room).emit("progress", status);
  clean_file_process(filePath);
};

const updateAudioMade360 = (idProjectVideo, data) => {
  const url_api = `${EVASION_API}/v2/project/update/import/audio`;

  const body = {
    idProjectVideo,
    filename: data.filename,
    urlAudio: data.urlAudio,
    duration: data.duration,
  };

  return fetch(url_api, {
    method: "POST",
    body: JSON.stringify(body),
  });
};
