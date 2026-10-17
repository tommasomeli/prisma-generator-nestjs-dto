export type ModelName = 'User' | 'Post';

export interface RelationDescriptor {
    type: string;
    isList: boolean;
}

export interface ModelManifest {
    primaryKey: string;
    entityFields: string[];
    relations: Record<string, RelationDescriptor>;
}

export const PrismaManifest: Record<ModelName, ModelManifest> = {
    "User": {
        "primaryKey": "id",
        "entityFields": [
            "id",
            "email",
            "name",
            "role",
            "bio",
            "posts",
            "createdAt",
            "updatedAt"
        ],
        "relations": {
            "posts": {
                "type": "Post",
                "isList": true
            }
        }
    },
    "Post": {
        "primaryKey": "id",
        "entityFields": [
            "id",
            "title",
            "body",
            "score",
            "meta",
            "author",
            "authorId",
            "createdAt"
        ],
        "relations": {
            "author": {
                "type": "User",
                "isList": false
            }
        }
    }
};
