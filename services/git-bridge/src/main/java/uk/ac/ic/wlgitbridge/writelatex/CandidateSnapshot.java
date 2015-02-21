package uk.ac.ic.wlgitbridge.writelatex;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import uk.ac.ic.wlgitbridge.bridge.RawDirectory;
import uk.ac.ic.wlgitbridge.bridge.RawFile;
import uk.ac.ic.wlgitbridge.util.Util;

import java.io.File;
import java.io.IOException;
import java.util.LinkedList;
import java.util.List;
import java.util.Map;
import java.util.Map.Entry;

/**
 * Created by Winston on 16/11/14.
 */
public class CandidateSnapshot {

    private final String projectName;
    private final int currentVersion;
    private final List<ServletFile> files;

    public CandidateSnapshot(String projectName, int currentVersion, RawDirectory directoryContents, RawDirectory oldDirectoryContents) {
        this.projectName = projectName;
        this.currentVersion = currentVersion;
        files = diff(directoryContents, oldDirectoryContents);
    }

    private List<ServletFile> diff(RawDirectory directoryContents, RawDirectory oldDirectoryContents) {
        List<ServletFile> files = new LinkedList<ServletFile>();
        Map<String, RawFile> fileTable = directoryContents.getFileTable();
        Map<String, RawFile> oldFileTable = oldDirectoryContents.getFileTable();
        for (Entry<String, RawFile> entry : fileTable.entrySet()) {
            RawFile file = entry.getValue();
            files.add(new ServletFile(file, oldFileTable.get(file.getPath())));
        }
        return files;
    }

    public void writeServletFiles(File rootGitDirectory) throws IOException {
        File directory = new File(rootGitDirectory, ".wlgb/atts/" + projectName);
        for (ServletFile file : files) {
            if (file.isChanged()) {
                file.writeToDisk(directory);
            }
        }
    }

    public JsonElement getJsonRepresentation(String postbackKey) {
        String projectURL = Util.getPostbackURL() + projectName;
        JsonObject jsonObject = new JsonObject();
        jsonObject.addProperty("latestVerId", currentVersion);
        jsonObject.add("files", getFilesAsJson(projectURL, postbackKey));
        jsonObject.addProperty("postbackUrl", projectURL + "/" + postbackKey + "/postback");
        return jsonObject;
    }

    private JsonArray getFilesAsJson(String projectURL, String postbackKey) {
        JsonArray filesArray = new JsonArray();
        for (ServletFile file : files) {
            filesArray.add(getFileAsJson(file, projectURL, postbackKey));
        }
        return filesArray;
    }

    private JsonObject getFileAsJson(ServletFile file, String projectURL, String postbackKey) {
        JsonObject jsonFile = new JsonObject();
        jsonFile.addProperty("name", file.getPath());
        if (file.isChanged()) {
            jsonFile.addProperty("url", projectURL + "/" + file.getPath() + "?key=" + postbackKey);
        }
        return jsonFile;
    }

    public String getProjectName() {
        return projectName;
    }

//    @Override
//    public int getPreviousVersionID() {
//        return previousVersionID;
//    }
//
//    @Override
//    public String getProjectURL() {
//        return projectURL;
//    }
//
//    @Override
//    public void approveWithVersionID(int versionID) {
//        callback.approveSnapshot(versionID, this);
//    }
//

//
//    @Override
//    public WLDirectoryNode getDirectoryNode() {
//        return directoryNode;
//    }

}
