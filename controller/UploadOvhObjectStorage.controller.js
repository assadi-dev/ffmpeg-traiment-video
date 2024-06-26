import {
	DIRECTORY_SEPARATOR,
	OVH_CREDENTIALS,
	upload_dir,
	CONTAINER_EVASION,
} from "../config/constant.config.js";
import OvhObjectStorageServices from "../services/OvhObjectStorage.services.js";
import { config } from "dotenv";
config();

export const upload_ovh = async (req, res) => {
  try {
    const ovhStorageServices = new OvhObjectStorageServices(OVH_CREDENTIALS);

    const options = {
      filePath: `${upload_dir}${DIRECTORY_SEPARATOR}1701167231509_GS010093.mp4`,
      remoteFilename: "test-objet-file.mp4",
      containerName: "media",
      segmentSize: 1024 * 1024 * 50,
    };
    await ovhStorageServices.connect();
    ovhStorageServices.uploadLargeFile(options);

    const listen = (progress) => {
      const percent = Math.ceil(progress * 100);
      console.log("progress upload", percent + "%");
    };
    ovhStorageServices.onProgress(listen);
    const finish = (response) => {
      console.log("finish", response);
    };
    ovhStorageServices.onSuccess(finish);

    res.json("ok");
  } catch (error) {
    const message = error.message;
    console.error("Upload error:", message);
    res.json({ message });
  }
};

export const upload_single_ovh = async (req, res) => {
  try {
    const ovhStorageServices = new OvhObjectStorageServices(OVH_CREDENTIALS);

    const filePath = req.body.filePath;
    const remoteFilename = req.body.remoteFilename;
    const containerName = CONTAINER_EVASION;
    ovhStorageServices.setContainer(containerName);

    await ovhStorageServices.connect();
    const url = await ovhStorageServices.singleUploadByPath(
      filePath,
      remoteFilename
    );

    res.json(url);
  } catch (error) {
    console.log(error);
  }
};
