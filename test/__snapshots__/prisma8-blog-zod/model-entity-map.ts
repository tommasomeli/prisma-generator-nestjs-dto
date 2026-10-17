import type { User as UserEntity } from './user/user.schema';
import type { Post as PostEntity } from './post/post.schema';

export interface ModelEntityMap {
    User: UserEntity;
    Post: PostEntity;
}
