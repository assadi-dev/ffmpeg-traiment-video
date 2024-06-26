import {
  createReadStream,
  createWriteStream,
  existsSync,
  statSync,
  unlinkSync,
  write,
} from "fs";
import {
  DIRECTORY_SEPARATOR,
  URL_FILE_UPLOAD,
  __dirname,
  upload_dir,
  platform,
  OVH_CREDENTIALS,
  OVH_CONTAINER,
} from "../config/constant.config.js";
import slugify from "slugify";
import fetch from "node-fetch";

export const getDelimiter = () => {
  if (platform == "win32") return "\\";
  else return "/";
};

export const generateGoprofilesObject = (fileObject) => {
  if (fileObject) {
    return {
      id: fileObject.id,
      filename: fileObject.filename,
      camera: fileObject.camera,
      path: cleanPathName(fileObject.path),
      progress: 0,
    };
  }
};
export const generateInsvfilesObject = (fileObject) => {
  if (fileObject) {
    return {
      id: fileObject.id,
      filename: fileObject.filename,
      camera: fileObject.camera,
      front: cleanPathName(fileObject.front),
      back: cleanPathName(fileObject.back),
      progress: 0,
      model: fileObject.model,
    };
  }
};

/**
 * Retourne l'emplacement réelle du fichier aux url contenant l'url du serveur
 * @param {*} filepath
 * @returns
 */
export const cleanPathName = (filepath = "") => {
  const URL_UPLOADS = URL_FILE_UPLOAD + "/uploads/";
  //console.log(URL_UPLOADS, filepath);
  const UPLOAD_FILES_PATH = `${__dirname}${DIRECTORY_SEPARATOR}uploads${DIRECTORY_SEPARATOR}`;
  return filepath.replace(URL_UPLOADS, UPLOAD_FILES_PATH);
};

/**
 * Execution de la fonction après un temps donné en millisecondes
 * @param {number} delay en millisecondes
 * @param {any} callback fonction à executer
 */
export const postDelayed = (delay = 500, callback = () => {}) => {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      callback();
      resolve("success");
    }, delay);
  });
};

/**
 * Suppression d'un fichier physiquement
 * .
 * @param {string} path Emplacement du fichier
 */
export const removeFile = (path) => {
  if (existsSync(path)) {
    unlinkSync(path);
  }
};

/**
 * Conversion d'un nom en slug
 * @param {String} name
 * @returns
 */
export const toSlugify = (name) => {
  return slugify(name, {
    replacement: "_",
    remove: /[*+~()'"!:@]/g,
    lower: true,
    trime: true,
  });
};

/**
 * Écrire un fichier à partir d'une URL
 * @param {string} url
 * @param {string} filename
 * @param {string} path_destination Destination du fichier
 * @param {void|Function} onProgress function qui r'envoie en paramètre sous forme d'objet la progression du téléchargement
 * @param {boolean} rewrite  active la réécriture sur le fichier existant
 */

export const writeFileFromUrl = (
  url,
  filename,
  path_destination,
  onProgress,
  rewrite = true
) => {
  return new Promise((resolve, reject) => {
    (async () => {
      try {
        let downloadedSize = 0;
        const destination = `${path_destination}${DIRECTORY_SEPARATOR}${toSlugify(
          filename
        )}`;
        if (existsSync(destination) && rewrite === false) {
          const filePath = await skipDownload(
            destination,
            filename,
            onProgress
          );
          resolve(filePath);
          downloadedSize = filePath.size;

          return;
        }
        const writeStream = createWriteStream(destination);

        const response = await fetch(url);
        if (!response.ok) {
          reject("Error downloading file: " + response.statusText);
        }

        const totalSize = parseInt(response.headers.get("content-length"), 10);

        response.body.pipe(writeStream);
        response.body.on("data", (chunk) => {
          //console.log("Downloading...");
          const chunkSize = parseInt(chunk.length);
          downloadedSize += chunkSize;
          const progress = Math.floor((downloadedSize / totalSize) * 100);
          if (onProgress) {
            const eventProgress = {
              progress,
              filename,
              path: destination,
            };
            onProgress(eventProgress);
          }
        });
        response.body.on("end", () => {
          console.log("finish download:", destination);
          writeStream.end();
        });

        writeStream.on("finish", () => {
          resolve({ path: destination, filename: filename });
        });
        writeStream.on("error", (err) => {
          writeStream.end();
          reject(err);
        });
      } catch (error) {
        console.error("Error downloading file:", error.message);
        reject(error.message);
      }
    })();
  });
};

/**
 * Retourne la liste des fichiers téléchargés
 * @param {Array} files
 * @param {String} destination Dossier d’empagement à enregistrer
 * @param {void|Function} callback fonction de recuperation du fichier téléchargé
 */

export const getDownloadedExportFiles = async (
  files = [],
  destination,
  callback
) => {
  return new Promise((resolve, reject) => {
    (async () => {
      const downloadedFiles = [];

      const logProgressDownload = (data) => {
        if (callback) {
          callback(data);
        }
      };
      try {
        for (const file of files) {
          if (file.src) {
            const snapshot = await writeFileFromUrl(
              file.src,
              `${file.filename}`,
              destination,
              logProgressDownload,
              false
            );
            downloadedFiles.push({ ...file, src: snapshot.path });
          }
        }
        resolve(downloadedFiles);
      } catch (error) {
        reject(error.message);
      }
    })();
  });
};

export const getTotalFilesSizeFromUrl = (files = []) => {
  return new Promise((resolve, reject) => {
    (async () => {
      let totalSize = 0;
      for (const file of files) {
        const response = await fetch(file.src);
        if (!response.ok) {
          reject(response.statusText);
        }
        totalSize = +parseInt(response.headers.get("content-length"), 10);
      }
      resolve(totalSize);
    })();
  });
};

export const extractOvhFileName = (ovhFileLink = "") => {
  const ovhUri = `${OVH_CREDENTIALS.endpoint}/${OVH_CONTAINER}/`;
  return ovhFileLink.replace(encodeURI(ovhUri), "").trim();
};

const skipDownload = (destination, filename, onProgress) => {
  return new Promise((resolve) => {
    if (existsSync(destination)) {
      const existPath = destination;
      const existFileSize = statSync(existPath);
      console.log("download has been skip:", destination);

      resolve({
        path: existPath,
        filename: filename,
        size: existFileSize.size,
      });
      if (onProgress) {
        const eventProgress = {
          progress: 100,
          filename,
          path: destination,
        };
        onProgress(eventProgress);
      }
    }
  });
};

/**
 *
 * @returns {string} retourne la date et l'heur du jour en millisecond
 */
export const getTimestamp = () => {
  const date = new Date();
  return date.getTime();
};
