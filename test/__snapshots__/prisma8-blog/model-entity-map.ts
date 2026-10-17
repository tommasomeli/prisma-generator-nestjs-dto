import type { Post as PostEntity } from './post/post.entity';
import type { User as UserEntity } from './user/user.entity';

export interface ModelEntityMap {
    Post: PostEntity;
    User: UserEntity;
}
