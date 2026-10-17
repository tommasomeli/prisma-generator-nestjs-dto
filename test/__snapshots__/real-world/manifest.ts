export type ModelName = 'ActionLog' | 'Language' | 'Mail' | 'MailTemplate' | 'Media' | 'MediaPath' | 'MfaRecoveryCode' | 'Notification' | 'Option' | 'User';

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
    "ActionLog": {
        "primaryKey": "id",
        "entityFields": [
            "id",
            "createdAt",
            "updatedAt",
            "deletedAt",
            "url",
            "method",
            "body",
            "userId",
            "ip"
        ],
        "relations": {}
    },
    "Language": {
        "primaryKey": "id",
        "entityFields": [
            "id",
            "createdAt",
            "updatedAt",
            "deletedAt",
            "label",
            "code",
            "primary"
        ],
        "relations": {
            "user": {
                "type": "User",
                "isList": true
            }
        }
    },
    "Mail": {
        "primaryKey": "id",
        "entityFields": [
            "id",
            "createdAt",
            "updatedAt",
            "deletedAt",
            "from",
            "to",
            "cc",
            "bcc",
            "subject",
            "body",
            "sentAt"
        ],
        "relations": {}
    },
    "MailTemplate": {
        "primaryKey": "id",
        "entityFields": [
            "id",
            "createdAt",
            "updatedAt",
            "deletedAt",
            "name",
            "label",
            "from",
            "to",
            "toTest",
            "cc",
            "bcc",
            "subject",
            "body"
        ],
        "relations": {}
    },
    "Media": {
        "primaryKey": "id",
        "entityFields": [
            "id",
            "createdAt",
            "updatedAt",
            "deletedAt",
            "name",
            "filename",
            "ext",
            "base64",
            "hidden",
            "path",
            "parent",
            "children",
            "formats",
            "mimeType"
        ],
        "relations": {
            "path": {
                "type": "MediaPath",
                "isList": false
            },
            "parent": {
                "type": "Media",
                "isList": false
            },
            "children": {
                "type": "Media",
                "isList": true
            },
            "user": {
                "type": "User",
                "isList": false
            }
        }
    },
    "MediaPath": {
        "primaryKey": "id",
        "entityFields": [
            "id",
            "createdAt",
            "updatedAt",
            "deletedAt",
            "pathname",
            "parent",
            "children",
            "media"
        ],
        "relations": {
            "parent": {
                "type": "MediaPath",
                "isList": false
            },
            "children": {
                "type": "MediaPath",
                "isList": true
            },
            "media": {
                "type": "Media",
                "isList": true
            }
        }
    },
    "MfaRecoveryCode": {
        "primaryKey": "id",
        "entityFields": [
            "id",
            "createdAt",
            "updatedAt",
            "user",
            "usedAt"
        ],
        "relations": {
            "user": {
                "type": "User",
                "isList": false
            }
        }
    },
    "Notification": {
        "primaryKey": "id",
        "entityFields": [
            "id",
            "createdAt",
            "updatedAt",
            "deletedAt",
            "title",
            "message",
            "type",
            "priority",
            "recipientType",
            "recipientId",
            "senderId",
            "isRead",
            "readAt",
            "deliveredAt",
            "data",
            "expiresAt"
        ],
        "relations": {}
    },
    "Option": {
        "primaryKey": "id",
        "entityFields": [
            "id",
            "createdAt",
            "updatedAt",
            "deletedAt",
            "key",
            "value"
        ],
        "relations": {}
    },
    "User": {
        "primaryKey": "id",
        "entityFields": [
            "id",
            "createdAt",
            "updatedAt",
            "deletedAt",
            "firstName",
            "lastName",
            "userName",
            "email",
            "gCalendarUrl",
            "avatarUrl",
            "role",
            "password",
            "isActive",
            "activatable",
            "provider",
            "avatar",
            "language",
            "mfaEnabled",
            "mfaMethod"
        ],
        "relations": {
            "avatar": {
                "type": "Media",
                "isList": false
            },
            "language": {
                "type": "Language",
                "isList": false
            },
            "mfaRecoveryCodes": {
                "type": "MfaRecoveryCode",
                "isList": true
            }
        }
    }
};
