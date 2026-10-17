import type { Post as PostEntity } from './post/post.schema';
import type { User as UserEntity } from './user/user.schema';

export interface ModelEntityMap {
    Post: PostEntity;
    User: UserEntity;
}
