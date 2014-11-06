package uk.ac.ic.wlgitbridge.writelatex.api.request.getforversion;

import com.google.gson.JsonElement;
import uk.ac.ic.wlgitbridge.writelatex.api.request.base.SnapshotAPIRequest;

/**
 * Created by Winston on 06/11/14.
 */
public class SnapshotGetForVersionRequest extends SnapshotAPIRequest<SnapshotGetForVersionResult> {

    public static final String API_CALL = "/snapshots";

    public SnapshotGetForVersionRequest(String projectName, int versionID) {
        super(projectName, API_CALL + "/" + versionID);
    }

    @Override
    protected SnapshotGetForVersionResult parseResponse(JsonElement json) {
        return new SnapshotGetForVersionResult(this, json);
    }

}
